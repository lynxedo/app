-- Time Records: split shifts, flag rules, flag clearing, and weekly payroll approval.
-- Additive only (new columns default to today's behaviour; new tables are service-role only).

-- 1. Auto clock-outs get a real marker instead of being recognised by their note text.
alter table public.time_punches
  add column if not exists is_auto_clock_out boolean not null default false;
update public.time_punches
  set is_auto_clock_out = true
  where punch_type = 'out' and note like 'Auto clock-out after%' and is_auto_clock_out = false;

-- 2. Split shifts. A day can hold several in/out slices; the gaps between them are
--    unpaid breaks. Only days on/after unpaid_breaks_from use the new rule — null keeps
--    the old first-in-to-last-out rule (today's behaviour for every other company).
alter table public.time_entries
  add column if not exists break_hours numeric(6,2) not null default 0;
alter table public.timesheet_settings
  add column if not exists unpaid_breaks_from date;
update public.timesheet_settings
  set unpaid_breaks_from = '2026-10-19'
  where company_id = '00000000-0000-0000-0000-000000000002' and unpaid_breaks_from is null;

-- 3. Flag rules an admin sets up in Time Records → Settings.
create table if not exists public.timesheet_flag_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in (
    'clock_in_before', 'clock_in_after', 'clock_out_before', 'clock_out_after',
    'day_hours_over', 'week_ot_over'
  )),
  time_value time,
  hours_value numeric(6,2),
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (
    (kind like 'clock\_%' and time_value is not null)
    or (kind not like 'clock\_%' and hours_value is not null and hours_value >= 0)
  )
);
create index if not exists timesheet_flag_rules_company_idx
  on public.timesheet_flag_rules (company_id) where deleted_at is null;
alter table public.timesheet_flag_rules enable row level security;

-- 4. A flag an admin has cleared. flag_key embeds the offending value, so an edit that
--    still breaks the rule produces a new key and the flag comes back.
create table if not exists public.timesheet_flag_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  week_start date not null,
  flag_key text not null,
  note text,
  cleared_by uuid references auth.users(id),
  cleared_at timestamptz not null default now(),
  unique (company_id, flag_key)
);
create index if not exists timesheet_flag_reviews_week_idx
  on public.timesheet_flag_reviews (company_id, week_start);
alter table public.timesheet_flag_reviews enable row level security;

-- 5. Payroll approval per pay week. Unapprove stamps revoked_* (history kept);
--    at most one live approval per week.
create table if not exists public.timesheet_week_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  week_start date not null,
  approved_by uuid references auth.users(id),
  approved_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz
);
create unique index if not exists timesheet_week_approvals_live_uniq
  on public.timesheet_week_approvals (company_id, week_start) where revoked_at is null;
alter table public.timesheet_week_approvals enable row level security;
