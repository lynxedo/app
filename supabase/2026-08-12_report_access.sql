-- APPLIED to the shared DB on 2026-08-12 (migrations
-- `report_access_per_report_grants_2026_08_12` and
-- `report_access_tighten_grants_2026_08_12`). Recorded here for the repo history;
-- re-running is harmless.
--
-- Per-report view grants: layer 2 of the REPORTS_PRD §12 access model. Layer 1 is
-- the `can_access_reports` section flag; this decides WHICH reports inside the
-- section a non-admin may open. A byte-for-byte mirror of scoreboard_board_access
-- so there is one access pattern in the codebase, not two.
--
-- Default is nothing-until-granted. That matters more here than for Scoreboards:
-- Crew & Labor shows what individuals earn per hour and Service Line Profitability
-- shows wage totals, so the section flag alone was handing out payroll-shaped pages
-- to anyone who needed Revenue.

create table if not exists public.report_access (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null,
  report_slug text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists report_access_unique
  on public.report_access (company_id, user_id, report_slug);

create index if not exists idx_report_access_user
  on public.report_access (company_id, user_id);

alter table public.report_access enable row level security;

-- A user may read only their own grants. The admin screen reads through the
-- service-role client, so nothing else needs a policy.
drop policy if exists report_access_select_own on public.report_access;
create policy report_access_select_own on public.report_access
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Defence in depth. RLS already blocks writes (there is no INSERT/UPDATE/DELETE
-- policy), but Supabase grants anon and authenticated full table access in the
-- public schema by default, so policy-absence is the ONLY thing standing between
-- anon and this table -- and a future permissive policy would silently open it.
-- Grants are the durable half. Nothing depends on these: writes go through the
-- service-role client, which bypasses both. See memory
-- `lesson_backfill_snapshot_tables_need_rls`.
revoke all on public.report_access from anon;
revoke insert, update, delete on public.report_access from authenticated;
grant select on public.report_access to authenticated;
