-- Work Orders — Phase 1.5: the Work Order list is fed from the Jobber schedule
-- (Reference/PRDs/WORK_ORDERS_AND_QUOTES_PRD.md §6 Phase 1.5, added Oct 2, 2026).
--
-- Ben (Oct 2, 2026): "wonder if we can do the work orders automatically based on
-- what is in Jobber. The route optimizer would be a way to change it. It changes
-- it in Jobber so that would update work orders as well."
--
-- ADDITIVE ONLY: nullable columns + one partial unique index. No backfill.
-- Applied to the shared DB via Supabase MCP apply_migration
-- `work_orders_jobber_feed_2026_10_02`.

-- 1) Which Jobber user is this Hub person? Set once in Admin → People. The feed
--    falls back to the first-name match the Route Optimizer has always used
--    (hub_users.display_name "Josh" ↔ jobber_users.name "Josh Allen") when unset.
alter table public.hub_users
  add column if not exists jobber_user_id text;

create unique index if not exists hub_users_jobber_user_idx
  on public.hub_users (company_id, jobber_user_id)
  where jobber_user_id is not null;

-- 2) Visit instructions live on the Jobber JOB and were never mirrored (the
--    Route Optimizer reads them live). The jobs sync now stores them so a
--    Jobber-fed stop can show the gate code / dog warning like an optimizer-sent one.
alter table public.jobs
  add column if not exists instructions text;

-- 3) A day the feed manages. NULL = created by the office (optimizer / by hand)
--    and not yet adopted by the feed.
alter table public.daily_log_entries
  add column if not exists synced_from_jobber_at timestamptz;

-- 4) Per-stop provenance. `source` = who created the row ('route' = Route
--    Optimizer's Send to Daily Log, as every existing row; 'jobber' = the feed).
--    `removed_from_jobber_at` is set instead of deleting when a visit leaves the
--    tech's day in Jobber but the stop already carries tech state (arrived, notes,
--    complete, an inspection…) — nothing a tech did is ever thrown away.
alter table public.daily_log_stops
  add column if not exists source text not null default 'route',
  add column if not exists jobber_synced_at timestamptz,
  add column if not exists removed_from_jobber_at timestamptz;

alter table public.daily_log_stops
  drop constraint if exists daily_log_stops_source_check;
alter table public.daily_log_stops
  add constraint daily_log_stops_source_check check (source in ('route', 'jobber'));
