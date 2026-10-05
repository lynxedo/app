-- Amber 90% — Phase 1 session 2: the morning summary + the run log.
--
-- amber_runs: one row per scheduled Amber run (today: the weekday morning
-- summary). The unique (company, kind, run_date) row IS the "already ran today"
-- guard — two cron ticks, or staging and prod both ticking against this shared
-- DB, can never post the summary twice. It also records what each run cost, which
-- is the measurement Ben wants before the daily spending cap's thresholds are set.
--
-- hub_assistant_settings gains the morning-summary settings. Off by default — a
-- company gets nothing until an admin switches it on.
--
-- Additive + inert. RLS enabled with no policies → service-role only.

create table if not exists public.amber_runs (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  -- 'morning' = the scheduled summary; 'morning_test' = "Run it now" from Admin
  -- (not one-per-day, so testing never blocks the real run).
  kind                text not null,
  run_date            date not null,
  status              text not null default 'running'
                        check (status in ('running', 'done', 'failed', 'skipped')),
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  model               text,
  input_tokens        integer not null default 0,
  output_tokens       integer not null default 0,
  cache_read_tokens   integer not null default 0,
  cache_write_tokens  integer not null default 0,
  model_calls         integer not null default 0,
  tool_calls          integer not null default 0,
  queued              integer not null default 0,
  -- Estimated from published per-token prices (lib/amber-run.ts). Null when the
  -- model has no known price.
  est_cost_usd        numeric(10, 4),
  summary             text,
  error               text
);
alter table public.amber_runs enable row level security;
revoke all on public.amber_runs from anon, authenticated;

create unique index if not exists amber_runs_once_per_day_uniq
  on public.amber_runs (company_id, kind, run_date)
  where kind = 'morning';
create index if not exists amber_runs_company_started_idx
  on public.amber_runs (company_id, started_at desc);

alter table public.hub_assistant_settings
  add column if not exists amber_morning_enabled boolean not null default false,
  add column if not exists amber_morning_time text not null default '08:10',
  add column if not exists amber_morning_days smallint[] not null default '{1,2,3,4,5}',
  add column if not exists amber_morning_room_id uuid;
