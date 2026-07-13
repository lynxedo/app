-- AI Receptionist — Level 4 scheduling config (increment 1: admin config only).
--
-- Additive + safe: a new per-service config table + one defaulted master-switch
-- column on voice_receptionist_settings. No existing behavior changes, and
-- Level 4 stays clamped (MAX_IMPLEMENTED_LEVEL) until the availability engine +
-- Jobber writes ship — this table just holds the rules the owner sets up.

-- Master switch (per company). Default OFF → the receptionist schedules nothing
-- out of the box; the owner opts in per service. Lives alongside the other
-- receptionist settings so one row per company still holds everything.
alter table public.voice_receptionist_settings
  add column if not exists scheduling_enabled boolean not null default false;

-- Per schedulable service — one row per Jobber line item the owner turns on.
create table if not exists public.voice_scheduling_services (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null,
  line_item         text not null,                          -- Jobber product/service name (from /api/jobber/line-items)
  mode              text not null default 'appointment' check (mode in ('appointment','recurring')),
  enabled           boolean not null default true,          -- soft on/off without losing the config
  duration_minutes  int  not null default 60  check (duration_minutes between 1 and 480),
  max_per_day       int  not null default 4   check (max_per_day between 1 and 100),
  time_frames       jsonb not null default '[]'::jsonb,     -- [{start:"08:00",end:"12:00"}] arrival windows
  offered_days      int[] not null default '{}',            -- 0=Sun..6=Sat; {} = any day
  assigned_user_ids jsonb not null default '[]'::jsonb,     -- Jobber user encoded ids (= teamMemberIdsToAssign)
  lead_days         int  not null default 1  check (lead_days between 0 and 60),
  horizon_days      int  not null default 30 check (horizon_days between 1 and 365),
  commitment        text not null default 'request' check (commitment in ('request','direct')),
  frequencies       jsonb not null default '[]'::jsonb,     -- recurring mode: ["weekly","biweekly"]
  sort_order        int  not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, line_item)
);

create index if not exists idx_voice_scheduling_services_company
  on public.voice_scheduling_services (company_id);

-- RLS: deny-all to anon/authenticated; access only via the service-role admin
-- client (the admin API route + the call-time voice endpoints), same posture as
-- the other voice_* config tables. No policies added = no anon/authenticated
-- reach; the service role bypasses RLS.
alter table public.voice_scheduling_services enable row level security;
