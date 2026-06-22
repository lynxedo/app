-- Contacts Directory (CRM core) — Phase 2a: tag provenance + Jobber tag backfill.
-- ADDITIVE. (1) Add a `source` to contact_tag_assignments so the Jobber sync can
-- mirror tag REMOVALS without ever touching manually-added tags. (2) One-time
-- mirror of the current Jobber client_tags into the unified directory tags, so
-- the directory reflects today's Jobber tags immediately (the nightly cron keeps
-- it fresh from here — see lib/contacts-directory.ts).

-- (1) provenance column (existing rows default to 'manual')
alter table public.contact_tag_assignments
  add column if not exists source text not null default 'manual';

-- (2a) ensure a unified tag definition exists for every Jobber tag in use
insert into public.contact_tags (company_id, label)
select distinct jt.company_id, jt.name
  from public.tags jt
  join public.client_tags clt on clt.tag_id = jt.id
 where jt.company_id = '00000000-0000-0000-0000-000000000002'
   and jt.name is not null and btrim(jt.name) <> ''
on conflict (company_id, label) do nothing;

-- (2b) assign those tags to the directory contact linked to each Jobber client
insert into public.contact_tag_assignments (contact_id, tag_id, source)
select distinct t.id, ct.id, 'jobber'
  from public.txt_contacts t
  join public.clients cl
    on cl.company_id = t.company_id and cl.external_id = t.jobber_client_id
  join public.client_tags clt on clt.client_id = cl.id
  join public.tags jt on jt.id = clt.tag_id
  join public.contact_tags ct
    on ct.company_id = t.company_id and lower(ct.label) = lower(jt.name)
 where t.company_id = '00000000-0000-0000-0000-000000000002'
   and t.jobber_client_id is not null
   and t.deleted_at is null
on conflict (contact_id, tag_id) do nothing;
