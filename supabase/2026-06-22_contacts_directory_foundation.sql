-- Contacts Directory (CRM core) — Phase 1a foundation.
-- ADDITIVE ONLY. Evolves the live txt_contacts spine into the unified contacts
-- directory shape (see Hub/CRM_CONTACTS_PRD.md). No column is dropped/renamed;
-- phone & name stay NOT NULL for now (the email-only fold-in + nullable change is
-- the later consent-aware cutover). Shared prod/staging DB: extra columns are
-- ignored by all existing explicit selects, so prod behavior is unchanged.
-- Applied to the shared DB on 2026-06-22 via Supabase migration of the same name.

alter table public.txt_contacts
  add column if not exists first_name      text,
  add column if not exists last_name       text,
  add column if not exists company_name    text,
  add column if not exists is_company      boolean not null default false,
  add column if not exists address_line1   text,
  add column if not exists address_line2   text,
  add column if not exists city            text,
  add column if not exists state           text,
  add column if not exists postal_code     text,
  add column if not exists country         text,
  add column if not exists email_status    text    not null default 'subscribed',
  add column if not exists sources         text[]  not null default '{}'::text[],
  add column if not exists manually_edited boolean not null default false,
  add column if not exists phone_digits    text,
  add column if not exists deleted_at      timestamptz;

-- Backfill the existing rows (Heroes' live comms spine, ~116 rows).
update public.txt_contacts
   set phone_digits = nullif(regexp_replace(coalesce(phone,''), '\D', '', 'g'), '')
 where phone_digits is null;

update public.txt_contacts
   set sources = array['sms']
 where sources = '{}'::text[];

-- Best-effort split of "First Last" display names (skip phone-number placeholders).
update public.txt_contacts
   set first_name = split_part(name, ' ', 1),
       last_name  = nullif(regexp_replace(name, '^\S+\s*', '', ''), '')
 where first_name is null
   and name is not null
   and name !~ '^\+?\d';

-- Match/lookup indexes for future Jobber/email backfill + directory search.
create index if not exists txt_contacts_company_phone_digits_idx
  on public.txt_contacts (company_id, phone_digits);
create index if not exists txt_contacts_company_email_idx
  on public.txt_contacts (company_id, lower(email)) where email is not null;
