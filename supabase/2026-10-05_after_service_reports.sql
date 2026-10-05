-- Work Orders Phase 3 — after-service reports (WF / MO lawn-treatment stops).
--
-- Built like irrigation_inspections (Ben, Oct 5 2026: "like the irrigation
-- inspection report in the manner it is attached to the customer file"): one
-- row per report, on the customer file, a `draft` working copy that the tech
-- saves into a `final` snapshot. Unlike an inspection, a report belongs to ONE
-- visit — at most one report per Jobber visit (or per stop, for a stop with no
-- visit id).
--
-- `data` holds the whole form. Customer-facing parts (services, what the tech
-- saw, recommendations) and INTERNAL parts (products applied + amounts, internal
-- notes) live side by side; the customer page (Phase 3 session 2) renders only
-- an allowlist. Customers never see product names (Ben, Oct 5 2026).
--
-- Also: pesticide_records.tech_confirmation — the tech's confirmation of what
-- was actually applied, written NEXT TO the mapped chemicals_applied (never over
-- it), so the TDA record keeps both and the CSV export keeps its shape.
--
-- ADDITIVE. Applied to the shared DB via Supabase MCP apply_migration
-- `after_service_reports_2026_10_05`.

create table if not exists public.after_service_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid not null references public.txt_contacts(id) on delete cascade,
  stop_id uuid references public.daily_log_stops(id) on delete set null,
  jobber_visit_id text,
  pesticide_record_id uuid references public.pesticide_records(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'final')),
  data jsonb not null default '{}'::jsonb,
  photo_keys text[] not null default '{}',
  share_token text unique,
  share_expires_at timestamptz,
  service_date date,
  finalized_at timestamptz,
  sent_at timestamptz,
  sent_via text[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists after_service_reports_company_contact_idx
  on public.after_service_reports (company_id, contact_id, status, finalized_at desc);

-- One report per visit. A stop with no Jobber visit id falls back to one per stop.
create unique index if not exists after_service_reports_one_per_visit_idx
  on public.after_service_reports (company_id, jobber_visit_id)
  where jobber_visit_id is not null;
create unique index if not exists after_service_reports_one_per_stop_idx
  on public.after_service_reports (stop_id)
  where jobber_visit_id is null and stop_id is not null;

create index if not exists after_service_reports_share_token_idx
  on public.after_service_reports (share_token)
  where share_token is not null;

alter table public.after_service_reports enable row level security;

-- Read-isolation only: company members read their company's reports. ALL writes
-- go through the service-role admin client with per-route authorization (Work
-- Orders grant or admin). The public customer page reads by verified token.
drop policy if exists after_service_reports_select on public.after_service_reports;
create policy after_service_reports_select on public.after_service_reports
  for select to authenticated
  using (company_id in (select company_id from public.user_profiles where id = auth.uid()));

revoke all on public.after_service_reports from anon;

alter table public.pesticide_records
  add column if not exists tech_confirmation jsonb;
