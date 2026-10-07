-- Fleet stops PRD (Reference/PRDs/FLEET_STOPS_AND_ARRIVAL_ALERTS_PRD.md) session 1:
-- which truck each tech drives. Fleet knows trucks (OneStepGPS device ids);
-- Work Orders knows people (hub_users) — this is the link.
-- ADDITIVE only: one new, empty table.
--
--  * effective_date NULL  = the standing assignment ("Mike usually drives Truck 3").
--  * effective_date set   = that day only ("Different truck today"). A day row wins
--    over the standing row for that truck, and a person with a day row is NOT also
--    on their usual truck that day. user_id NULL on a day row = nobody drives that
--    truck that day.
--  * Real people only (Ben, Oct 6 2026) — the HLC IR / HLC WF crew accounts are
--    never offered.
create table if not exists public.fleet_vehicle_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  device_id text not null,
  user_id uuid references public.hub_users(id) on delete cascade,
  effective_date date,
  created_by uuid references public.hub_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fleet_vehicle_assignments_standing_has_user
    check (effective_date is not null or user_id is not null)
);

-- One row per truck per day (and one standing row per truck).
create unique index if not exists fleet_vehicle_assignments_device_day
  on public.fleet_vehicle_assignments (company_id, device_id, effective_date) nulls not distinct;

-- One truck per person per day (and one standing truck per person).
create unique index if not exists fleet_vehicle_assignments_user_day
  on public.fleet_vehicle_assignments (company_id, user_id, effective_date) nulls not distinct
  where user_id is not null;

alter table public.fleet_vehicle_assignments enable row level security;

-- Reads for the signed-in company; every write goes through the service-role
-- admin API (Admin → Fleet, gated can_admin_fleet).
drop policy if exists fleet_vehicle_assignments_select on public.fleet_vehicle_assignments;
create policy fleet_vehicle_assignments_select on public.fleet_vehicle_assignments
  for select using (company_id = get_my_company_id());

revoke all on public.fleet_vehicle_assignments from anon;
