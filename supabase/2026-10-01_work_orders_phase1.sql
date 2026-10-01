-- Work Orders — Phase 1 (Reference/PRDs/WORK_ORDERS_AND_QUOTES_PRD.md §6 Phase 1)
--
-- Every Daily Log v2 stop ("work order") learns which customer file, Jobber
-- client and Jobber job it belongs to, and an irrigation inspection learns which
-- stop / Jobber visit it was done on. Both directions of the link the PRD asks
-- for (rule 7: stop → customer file → reports; report → stop → day).
--
-- ADDITIVE ONLY. New nullable columns + indexes + a backfill that fills ONLY the
-- new columns from the Jobber visits mirror. Nothing existing is altered or
-- removed. Applied to the shared DB via Supabase MCP apply_migration
-- `work_orders_phase1_2026_10_01`.
--
-- ⚠ Re-sending a route from the Route Optimizer DELETES and re-inserts the
-- day's stops (from-route/route.ts), so a stop id is not stable across a
-- re-send. The Jobber visit id IS stable. Inspections therefore key on
-- jobber_visit_id first; stop_id is a convenience pointer that goes NULL on a
-- re-send (on delete set null) and is re-derived from the visit id by the API.

-- 1) Stops → customer file + Jobber client/job -------------------------------
alter table public.daily_log_stops
  add column if not exists contact_id uuid references public.txt_contacts(id) on delete set null,
  add column if not exists jobber_client_id text,
  add column if not exists jobber_job_id text;

create index if not exists daily_log_stops_contact_idx
  on public.daily_log_stops (contact_id)
  where contact_id is not null;

create index if not exists daily_log_stops_jobber_visit_idx
  on public.daily_log_stops (jobber_visit_id)
  where jobber_visit_id is not null;

-- 2) Inspections → stop / Jobber visit ----------------------------------------
alter table public.irrigation_inspections
  add column if not exists stop_id uuid references public.daily_log_stops(id) on delete set null,
  add column if not exists jobber_visit_id text;

create index if not exists irrigation_inspections_visit_idx
  on public.irrigation_inspections (company_id, jobber_visit_id)
  where jobber_visit_id is not null;

create index if not exists irrigation_inspections_stop_idx
  on public.irrigation_inspections (stop_id)
  where stop_id is not null;

-- 3) Backfill existing stops --------------------------------------------------
-- Stop → visits mirror (by Jobber visit id, same company) → job + client ids.
update public.daily_log_stops s
set jobber_job_id    = coalesce(s.jobber_job_id, v.job_external_id),
    jobber_client_id = coalesce(s.jobber_client_id, v.client_external_id)
from public.daily_log_entries e, public.visits v
where e.id = s.entry_id
  and v.company_id = e.company_id
  and v.external_id = s.jobber_visit_id
  and (s.jobber_job_id is null or s.jobber_client_id is null);

-- Jobber client id → the directory contact (oldest live row wins if duplicated).
-- (Correlated subquery in SET — an UPDATE cannot reference its target table
-- from a LATERAL item in FROM.)
update public.daily_log_stops s
set contact_id = (
  select t.id
  from public.txt_contacts t
  where t.company_id = e.company_id
    and t.jobber_client_id = s.jobber_client_id
    and t.deleted_at is null
  order by t.created_at asc
  limit 1
)
from public.daily_log_entries e
where e.id = s.entry_id
  and s.contact_id is null
  and s.jobber_client_id is not null;
