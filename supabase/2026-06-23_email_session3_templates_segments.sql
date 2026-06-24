-- Email Marketing Session 3: reusable templates + saved segments.
-- Applied to the shared Supabase DB on 2026-06-23 via MCP. Additive only.
-- Writes go through the service-role admin client (after a can_access_email check
-- in the route); authenticated users get a company-scoped SELECT policy, mirroring
-- email_settings / email_imports.

create table if not exists public.email_templates (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null,
  subject       text not null default '',
  body_markdown text not null default '',
  body_html     text not null default '',
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_email_templates_company on public.email_templates(company_id);

create table if not exists public.email_segments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  -- filter shape: { "has_tag": [tag_id,...], "missing_tag": [tag_id,...] }
  -- {} (empty) => all subscribed contacts ("everyone")
  filter      jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_email_segments_company on public.email_segments(company_id);

alter table public.email_templates enable row level security;
alter table public.email_segments  enable row level security;

create policy email_templates_select_company on public.email_templates
  for select to authenticated
  using (company_id in (select up.company_id from public.user_profiles up where up.id = auth.uid()));

create policy email_segments_select_company on public.email_segments
  for select to authenticated
  using (company_id in (select up.company_id from public.user_profiles up where up.id = auth.uid()));
