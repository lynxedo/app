-- Contacts Directory (CRM core) — Phase 1b: full backfill into the unified directory.
-- Folds email_contacts + Jobber clients into txt_contacts (the directory), with
-- one-person-one-row dedupe. See Hub/CRM_CONTACTS_PRD.md.
--
-- SAFETY / shared prod+staging DB:
--   * Runs in ONE transaction; the final UNIQUE index is the atomic gate — if any
--     duplicate email slipped through, the whole migration rolls back.
--   * CONSENT GUARD: every row that is newly created, or that GAINS a phone from a
--     non-texting source, is set do_not_text = true. The existing texted-in rows
--     keep their consent untouched. Prod's texting pickers exclude do_not_text by
--     default, so no un-consented customer becomes textable.
--   * Reversible: backfilled rows are identifiable by sources && {jobber,import,manual}
--     without {sms,voice}; enrichment only fills blanks / adds links.
--
-- ROLLBACK sketch (if ever needed):
--   delete from txt_contacts
--    where company_id = '00000000-0000-0000-0000-000000000002'
--      and not (sources && array['sms','voice'])
--      and created_at >= '<migration timestamp>';
--   (enrichment of the texted-in rows is additive and harmless to leave.)

-- ── 0. schema: allow email-only (phone-less) contacts ───────────────────────
alter table public.txt_contacts alter column phone drop not null;

-- ── 1. resolve any pre-existing internal duplicate emails (keep newest) ──────
with ranked as (
  select t.id,
         row_number() over (partition by t.company_id, lower(t.email)
                            order by t.updated_at desc, t.created_at desc) rn
  from public.txt_contacts t
  where t.company_id = '00000000-0000-0000-0000-000000000002'
    and t.email is not null and t.email <> ''
)
update public.txt_contacts t
   set email = null
  from ranked r
 where t.id = r.id and r.rn > 1;

-- ── 2. fold email_contacts → directory (email-keyed; no phones in this table) ─
do $$
declare
  co uuid := '00000000-0000-0000-0000-000000000002';
  r  record;
  existing_id uuid;
  nm text;
begin
  for r in
    select email, first_name, last_name, source, status
      from public.email_contacts
     where company_id = co and email is not null and email <> ''
  loop
    select id into existing_id from public.txt_contacts
     where company_id = co and lower(email) = lower(r.email)
     limit 1;

    if existing_id is not null then
      update public.txt_contacts
         set sources    = (select array(select distinct unnest(sources || array[coalesce(r.source,'import')]))),
             first_name = coalesce(first_name, r.first_name),
             last_name  = coalesce(last_name,  r.last_name)
       where id = existing_id;
    else
      nm := nullif(btrim(coalesce(r.first_name,'') || ' ' || coalesce(r.last_name,'')), '');
      insert into public.txt_contacts
        (company_id, name, first_name, last_name, email, email_status,
         phone, do_not_text, sources, manually_edited)
      values
        (co, coalesce(nm, r.email), r.first_name, r.last_name, r.email, coalesce(r.status,'subscribed'),
         null, true, array[coalesce(r.source,'import')], false);
    end if;
  end loop;
end $$;

-- ── 3. honor the suppression ledger (opt-outs win over 'subscribed') ─────────
update public.txt_contacts t
   set email_status = 'unsubscribed'
  from public.email_suppressions s
 where t.company_id = s.company_id
   and t.email is not null
   and lower(t.email) = lower(s.email)
   and t.email_status <> 'unsubscribed';

-- ── 4. backfill Jobber clients → directory (phone-or-email match, else insert)
do $$
declare
  co uuid := '00000000-0000-0000-0000-000000000002';
  c  record;
  digits text; ten text; e164 text;
  existing_id uuid;
  nm text;
begin
  for c in
    select id, external_id, name, first_name, last_name, company_name,
           is_company, email, phone
      from public.clients
     where company_id = co and deleted_at is null
  loop
    digits := regexp_replace(coalesce(c.phone,''), '\D', '', 'g');
    if length(digits) in (10, 11) then
      ten  := right(digits, 10);
      e164 := '+1' || ten;
    else
      ten := null; e164 := null;   -- malformed / international: skip the phone
    end if;
    nm := coalesce(nullif(btrim(c.name),''),
                   nullif(btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')),''),
                   c.email, 'Unknown');

    existing_id := null;

    -- (a) match an existing PHONE row (the consented texted-in contacts) → enrich, keep consent
    if ten is not null then
      select id into existing_id from public.txt_contacts
       where company_id = co and phone_digits is not null and right(phone_digits,10) = ten
       limit 1;
      if existing_id is not null then
        update public.txt_contacts
           set jobber_client_id = coalesce(jobber_client_id, c.external_id),
               sources      = (select array(select distinct unnest(sources || array['jobber']))),
               first_name   = coalesce(first_name, c.first_name),
               last_name    = coalesce(last_name,  c.last_name),
               company_name = coalesce(company_name, c.company_name),
               is_company   = is_company or coalesce(c.is_company,false)
         where id = existing_id;
        -- adopt the client's email onto this phone row ONLY if it's free (no other
        -- row already owns it) — otherwise leave it as a cross-key dup for the
        -- manual-merge tool (PRD §7), never break the unique email index.
        if c.email is not null and c.email <> '' then
          update public.txt_contacts
             set email = c.email
           where id = existing_id and email is null
             and not exists (select 1 from public.txt_contacts t2
                              where t2.company_id = co and t2.id <> existing_id
                                and t2.email is not null and lower(t2.email) = lower(c.email));
        end if;
        continue;
      end if;
    end if;

    -- (b) else match by EMAIL (e.g. a row folded from email_contacts) → enrich,
    --     adding the phone (no texting consent ⇒ do_not_text = true). Phone is
    --     guaranteed unused here because (a) found no phone match.
    if c.email is not null and c.email <> '' then
      select id into existing_id from public.txt_contacts
       where company_id = co and email is not null and lower(email) = lower(c.email)
       limit 1;
      if existing_id is not null then
        update public.txt_contacts
           set jobber_client_id = coalesce(jobber_client_id, c.external_id),
               sources      = (select array(select distinct unnest(sources || array['jobber']))),
               first_name   = coalesce(first_name, c.first_name),
               last_name    = coalesce(last_name,  c.last_name),
               company_name = coalesce(company_name, c.company_name),
               is_company   = is_company or coalesce(c.is_company,false),
               phone        = coalesce(phone, e164),
               phone_digits = coalesce(phone_digits, ten),
               do_not_text  = case when phone is null and e164 is not null then true else do_not_text end
         where id = existing_id;
        continue;
      end if;
    end if;

    -- (c) else INSERT a new directory row (no texting consent ⇒ do_not_text=true)
    insert into public.txt_contacts
      (company_id, name, first_name, last_name, company_name, is_company,
       phone, phone_digits, email, email_status, jobber_client_id,
       do_not_text, sources, manually_edited)
    values
      (co, nm, c.first_name, c.last_name, c.company_name, coalesce(c.is_company,false),
       e164, ten, c.email, 'subscribed', c.external_id,
       true, array['jobber'], false);
  end loop;
end $$;

-- re-honor suppressions for any emails just added via clients
update public.txt_contacts t
   set email_status = 'unsubscribed'
  from public.email_suppressions s
 where t.company_id = s.company_id
   and t.email is not null
   and lower(t.email) = lower(s.email)
   and t.email_status <> 'unsubscribed';

-- ── 5. migrate the email tag system into the unified contact tags ────────────
--   email_contact_tags(tag text) → contact_tags(label) + contact_tag_assignments
do $$
declare
  co uuid := '00000000-0000-0000-0000-000000000002';
  r record;
  tag_id_v uuid;
  contact_id_v uuid;
begin
  for r in
    select distinct ect.tag, lower(e.email) as email
      from public.email_contact_tags ect
      join public.email_contacts e on e.id = ect.contact_id
     where e.company_id = co and e.email is not null and ect.tag is not null and btrim(ect.tag) <> ''
  loop
    -- find-or-create the tag definition
    select id into tag_id_v from public.contact_tags
     where company_id = co and lower(label) = lower(r.tag) limit 1;
    if tag_id_v is null then
      insert into public.contact_tags (company_id, label)
      values (co, r.tag)
      on conflict (company_id, label) do update set label = excluded.label
      returning id into tag_id_v;
    end if;

    -- locate the directory contact by email
    select id into contact_id_v from public.txt_contacts
     where company_id = co and email is not null and lower(email) = r.email limit 1;

    if contact_id_v is not null and tag_id_v is not null then
      insert into public.contact_tag_assignments (contact_id, tag_id)
      values (contact_id_v, tag_id_v)
      on conflict (contact_id, tag_id) do nothing;
    end if;
  end loop;
end $$;

-- ── 6. atomic safety gate: unique email index (rolls back the txn on any dup) ─
drop index if exists public.txt_contacts_company_email_idx;
create unique index txt_contacts_company_email_uk
  on public.txt_contacts (company_id, lower(email)) where email is not null;
