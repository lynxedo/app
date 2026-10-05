-- Work Orders Phase 3 (session 2) — the customer-facing words on an
-- after-service report: what each treatment does, and the care instructions.
--
-- Ben, Oct 5 2026: customers never see product names — "just a description of
-- what the treatment does". The office writes that once per service (a Jobber
-- line item such as "WF - Lawn Health Basic"), optionally with different words
-- for one round (a Service Mapping round label, e.g. "Round 3" — the round in
-- effect on the visit date). A report copies the matching text in when it is
-- saved, so editing the text later never changes a report already sent.
--
-- `service_name` matches the line item like the pesticide mapping does: the
-- line item's name CONTAINS it (case-insensitive); the longest match wins.
--
-- ADDITIVE. Applied to the shared DB via Supabase MCP apply_migration
-- `after_service_templates_2026_10_05`, plus the Heroes starter text below
-- (marked "starter text" — the office rewrites it on the Work Orders office
-- page → Report text).

create table if not exists public.after_service_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  service_name text not null,
  round_label text,
  description text not null default '',
  care text not null default '',
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists after_service_templates_uk
  on public.after_service_templates (company_id, lower(service_name), coalesce(lower(round_label), ''))
  where deleted_at is null;

alter table public.after_service_templates enable row level security;
drop policy if exists after_service_templates_select on public.after_service_templates;
create policy after_service_templates_select on public.after_service_templates
  for select to authenticated
  using (company_id in (select company_id from public.user_profiles where id = auth.uid()));
revoke all on public.after_service_templates from anon;

-- Heroes starter text (15 services, round_label NULL = every round, created_by
-- NULL = starter text) was inserted with execute_sql the same day; see the
-- session archive. Not repeated here so re-running this file seeds nothing.
