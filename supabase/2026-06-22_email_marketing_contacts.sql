-- Email Marketing — Session 2: master contact list, tags, suppressions, import audit.
-- Spec: Hub/EMAIL_MARKETING_PRD.md §6a. All additive, RLS company-scoped (reads for
-- company members; writes go through the admin API on the service role). Email
-- uniqueness is case-insensitive via lower(email) unique indexes.

-- ── email_contacts : the master audience ────────────────────────────────────
create table if not exists public.email_contacts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  email             text not null,
  first_name        text,
  last_name         text,
  source            text not null default 'manual',     -- 'jobber' | 'import' | 'manual'
  jobber_client_id  uuid,                                -- set for Jobber-sourced contacts
  status            text not null default 'subscribed',  -- 'subscribed'|'unsubscribed'|'bounced'|'complained'
  imported_batch_id uuid,                                -- links to the import that created it
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists email_contacts_company_email_uniq
  on public.email_contacts (company_id, lower(email));
create index if not exists email_contacts_company_status_idx
  on public.email_contacts (company_id, status);
create index if not exists email_contacts_jobber_client_idx
  on public.email_contacts (jobber_client_id) where jobber_client_id is not null;

-- ── email_contact_tags : unified tags across all sources ────────────────────
create table if not exists public.email_contact_tags (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.email_contacts(id) on delete cascade,
  tag         text not null,
  source      text not null default 'manual',  -- 'jobber' | 'mailchimp' | 'manual'
  created_at  timestamptz not null default now(),
  unique (contact_id, tag)
);
create index if not exists email_contact_tags_tag_idx on public.email_contact_tags (tag);

-- ── email_suppressions : do-not-email (honored on every send) ───────────────
create table if not exists public.email_suppressions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  email       text not null,
  reason      text not null,  -- 'unsubscribe' | 'bounce' | 'complaint' | 'manual'
  created_at  timestamptz not null default now()
);
create unique index if not exists email_suppressions_company_email_uniq
  on public.email_suppressions (company_id, lower(email));

-- ── email_imports : audit/undo for CSV / Mailchimp imports ──────────────────
create table if not exists public.email_imports (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  filename         text,
  source           text not null default 'csv',  -- 'csv' | 'mailchimp'
  list_type        text,                          -- 'subscribed' | 'unsubscribed' | 'cleaned'
  total_rows       int not null default 0,
  created_count    int not null default 0,
  updated_count    int not null default 0,
  suppressed_count int not null default 0,
  skipped_count    int not null default 0,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now()
);
create index if not exists email_imports_company_idx on public.email_imports (company_id, created_at desc);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.email_contacts     enable row level security;
alter table public.email_contact_tags enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.email_imports      enable row level security;

drop policy if exists email_contacts_select_company on public.email_contacts;
create policy email_contacts_select_company on public.email_contacts
  for select using (
    company_id in (select up.company_id from public.user_profiles up where up.id = auth.uid())
  );

drop policy if exists email_suppressions_select_company on public.email_suppressions;
create policy email_suppressions_select_company on public.email_suppressions
  for select using (
    company_id in (select up.company_id from public.user_profiles up where up.id = auth.uid())
  );

drop policy if exists email_imports_select_company on public.email_imports;
create policy email_imports_select_company on public.email_imports
  for select using (
    company_id in (select up.company_id from public.user_profiles up where up.id = auth.uid())
  );

drop policy if exists email_contact_tags_select_company on public.email_contact_tags;
create policy email_contact_tags_select_company on public.email_contact_tags
  for select using (
    exists (
      select 1 from public.email_contacts ec
      join public.user_profiles up on up.company_id = ec.company_id
      where ec.id = email_contact_tags.contact_id and up.id = auth.uid()
    )
  );
