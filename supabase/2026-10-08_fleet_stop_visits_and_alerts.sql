-- Fleet stops PRD sessions 2 + 3 (built together, Oct 8 2026):
-- arrived / left times per Work Order stop + custom arrival alerts from Amber.
-- ADDITIVE only: three new, empty tables + one new fleet_settings column.
--
-- Arrived = the tech's Arrived tap (daily_log_stops.arrived_at); GPS is the backup.
-- Left    = the stop completed (daily_log_stops.completed_at — Work Orders or
--           Jobber); GPS (the truck drove away) is the backup.
-- The tech/Jobber times stay on daily_log_stops and are NEVER written here; this
-- table holds only what GPS saw, plus the first time each event was known (what
-- the alerts fire on).

create table if not exists public.fleet_stop_visits (
  stop_id uuid primary key references public.daily_log_stops(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  log_date date not null,
  tech_user_id uuid references public.hub_users(id) on delete set null,
  device_id text,
  -- GPS working state: the truck has been within the arrive radius since…
  gps_near_since timestamptz,
  -- GPS saw the truck sit at the stop (2+ min) — the time it got there.
  gps_arrived_at timestamptz,
  -- GPS working state: the truck has been outside the leave radius since…
  gps_away_since timestamptz,
  -- GPS saw the truck drive away — the time it left.
  gps_left_at timestamptz,
  -- First moment each event was known from ANY source (tap, completion, GPS).
  -- Alerts fire from these; once set they never move.
  first_arrived_at timestamptz,
  first_arrived_source text check (first_arrived_source in ('tech', 'gps')),
  first_left_at timestamptz,
  first_left_source text check (first_left_source in ('tech', 'jobber', 'gps')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fleet_stop_visits_company_day
  on public.fleet_stop_visits (company_id, log_date);

-- Custom alerts. Each person sets up their own; every alert has its own on/off.
--  kind: arrive_stop / leave_stop  — one stop, one day (set from a stop pin)
--        arrive_first / arrive_last / leave_last — standing rule, every day
--  tech_user_id NULL on a standing rule = any tech.
create table if not exists public.fleet_arrival_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid not null references public.hub_users(id) on delete cascade,
  kind text not null check (kind in ('arrive_stop', 'leave_stop', 'arrive_first', 'arrive_last', 'leave_last')),
  tech_user_id uuid references public.hub_users(id) on delete cascade,
  stop_id uuid references public.daily_log_stops(id) on delete cascade,
  alert_date date,
  enabled boolean not null default true,
  -- Events before this moment never fire it (turning an alert on doesn't replay
  -- the morning's arrivals).
  enabled_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fleet_arrival_alerts_stop_kinds check (
    (kind in ('arrive_stop', 'leave_stop')) = (stop_id is not null and alert_date is not null)
  )
);
create index if not exists fleet_arrival_alerts_company
  on public.fleet_arrival_alerts (company_id) where deleted_at is null;

-- Each alert fires at most once per stop (the unique key is the guarantee).
create table if not exists public.fleet_arrival_alert_fires (
  alert_id uuid not null references public.fleet_arrival_alerts(id) on delete cascade,
  stop_id uuid not null references public.daily_log_stops(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  fired_at timestamptz not null default now(),
  message_id uuid,
  primary key (alert_id, stop_id)
);

-- Company master switch for arrival alerts (Admin → Fleet). Default on: no alert
-- exists until someone sets one up, so "on" changes nothing today.
alter table public.fleet_settings add column if not exists alert_arrivals boolean not null default true;

alter table public.fleet_stop_visits enable row level security;
alter table public.fleet_arrival_alerts enable row level security;
alter table public.fleet_arrival_alert_fires enable row level security;

-- Reads for the signed-in company; every write goes through service-role APIs
-- (the cron tick, and /api/fleet/arrival-alerts which checks can_access_fleet
-- and that the alert is the caller's own).
drop policy if exists fleet_stop_visits_select on public.fleet_stop_visits;
create policy fleet_stop_visits_select on public.fleet_stop_visits
  for select using (company_id = get_my_company_id());
drop policy if exists fleet_arrival_alerts_select on public.fleet_arrival_alerts;
create policy fleet_arrival_alerts_select on public.fleet_arrival_alerts
  for select using (company_id = get_my_company_id() and created_by = auth.uid());
drop policy if exists fleet_arrival_alert_fires_select on public.fleet_arrival_alert_fires;
create policy fleet_arrival_alert_fires_select on public.fleet_arrival_alert_fires
  for select using (company_id = get_my_company_id());

revoke all on public.fleet_stop_visits from anon;
revoke all on public.fleet_arrival_alerts from anon;
revoke all on public.fleet_arrival_alert_fires from anon;
