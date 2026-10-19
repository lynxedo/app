-- Dispatch (Reference/PRDs/DISPATCH_ROUTING_PRD.md) — Phase 1 tables.
-- Adds only; nothing existing is changed or dropped.
--
-- Jobber stays the schedule of record. Hub stores only what Jobber can't:
--   • locked time frames (= PROMISED stops) — Jobber's visit edit takes start/end only
--   • the unsent draft of moves, so a closed tab loses nothing
--   • per-tech start/end overrides (default = the company depot)
--   • Dispatch settings (arrival bounds, reminder cutoff, color rules) on the
--     existing company_routing_settings row
--
-- Same access model as route_batches: company members READ through RLS; every
-- write goes through an API route that checks can_access_routing and uses the
-- service-role client scoped by company_id. No write policies on purpose.

alter table public.company_routing_settings
  add column if not exists dispatch_settings jsonb not null default '{}'::jsonb;

create table if not exists public.dispatch_visit_locks (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  jobber_item_id  text not null,
  item_kind       text not null default 'visit' check (item_kind in ('visit','assessment','task')),
  window_start    timestamptz not null,
  window_end      timestamptz not null,
  locked_by       uuid,
  locked_source   text not null default 'office' check (locked_source in ('office','amber','parser')),
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint dispatch_visit_locks_window_ok check (window_end > window_start),
  constraint dispatch_visit_locks_unique unique (company_id, jobber_item_id)
);

create table if not exists public.dispatch_drafts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  draft_date   date not null,
  changes      jsonb not null default '[]'::jsonb,
  created_by   uuid,
  updated_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint dispatch_drafts_unique unique (company_id, draft_date)
);

create table if not exists public.dispatch_tech_settings (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  jobber_user_id  text not null,
  start_kind      text not null default 'depot' check (start_kind in ('depot','address')),
  start_address   text,
  start_lat       double precision,
  start_lng       double precision,
  end_kind        text not null default 'depot' check (end_kind in ('depot','address')),
  end_address     text,
  end_lat         double precision,
  end_lng         double precision,
  updated_by      uuid,
  updated_at      timestamptz not null default now(),
  constraint dispatch_tech_settings_unique unique (company_id, jobber_user_id)
);

alter table public.dispatch_visit_locks   enable row level security;
alter table public.dispatch_drafts        enable row level security;
alter table public.dispatch_tech_settings enable row level security;

revoke all on public.dispatch_visit_locks, public.dispatch_drafts, public.dispatch_tech_settings from anon;

drop policy if exists dispatch_visit_locks_select_company on public.dispatch_visit_locks;
create policy dispatch_visit_locks_select_company on public.dispatch_visit_locks
  for select using (company_id = get_my_company_id());

drop policy if exists dispatch_drafts_select_company on public.dispatch_drafts;
create policy dispatch_drafts_select_company on public.dispatch_drafts
  for select using (company_id = get_my_company_id());

drop policy if exists dispatch_tech_settings_select_company on public.dispatch_tech_settings;
create policy dispatch_tech_settings_select_company on public.dispatch_tech_settings
  for select using (company_id = get_my_company_id());

-- Phase 2 — every Optimize / Find-a-slot run, for "why did it put that there".
create table if not exists public.dispatch_runs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  kind          text not null check (kind in ('optimize','slots')),
  run_date      date,
  requested_by  uuid,
  input         jsonb not null default '{}'::jsonb,
  output        jsonb not null default '{}'::jsonb,
  cost_ms       integer,
  created_at    timestamptz not null default now()
);
create index if not exists dispatch_runs_company_created on public.dispatch_runs (company_id, created_at desc);
alter table public.dispatch_runs enable row level security;
revoke all on public.dispatch_runs from anon;
drop policy if exists dispatch_runs_select_company on public.dispatch_runs;
create policy dispatch_runs_select_company on public.dispatch_runs
  for select using (company_id = get_my_company_id());

-- Phase 3 — Hub day-before reminders. One row per item + day + channel, claimed
-- BEFORE sending (UNIQUE), so two runs — or staging and prod on the shared DB —
-- can never both send the same reminder.
create table if not exists public.dispatch_reminders (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  jobber_item_id  text not null,
  visit_date      date not null,
  channel         text not null check (channel in ('sms','email')),
  status          text not null default 'sending' check (status in ('sending','sent','failed')),
  template_id     text,
  sent_to         text,
  body            text,
  provider_id     text,
  error           text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  constraint dispatch_reminders_once unique (company_id, jobber_item_id, visit_date, channel)
);
create index if not exists dispatch_reminders_company_date on public.dispatch_reminders (company_id, visit_date);
alter table public.dispatch_reminders enable row level security;
revoke all on public.dispatch_reminders from anon;
drop policy if exists dispatch_reminders_select_company on public.dispatch_reminders;
create policy dispatch_reminders_select_company on public.dispatch_reminders
  for select using (company_id = get_my_company_id());
