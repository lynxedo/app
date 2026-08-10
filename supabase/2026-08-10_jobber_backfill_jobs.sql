-- Resumable per-company Jobber backfill — August 10, 2026
-- (APPLIED to the shared DB on 2026-08-10.)
--
-- WHY. Onboarding a second subscriber was impossible: the initial pull took its
-- company from an ENV VAR (so only one tenant could ever be synced), the history
-- floor was hardcoded 'after: 2026-01-01' in three separate filters (a new
-- subscriber got no history before 2026, and the window widened every January),
-- and the pull was not resumable — no cursor persistence, no progress. Heroes' own
-- pull takes 10–20 minutes; a subscriber with years of history takes hours, which
-- no single request can carry.
--
-- WHAT. One row per company tracking a backfill that can stop and resume. The
-- orchestrator advances in time-bounded slices, persisting its cursor after EVERY
-- page, so a timeout, deploy or crash costs one page rather than the whole run. A
-- cron advances it until done. Entities are walked in dependency order (clients →
-- properties → jobs → visits → invoices) so a partial backfill is always
-- internally consistent — a visit never lands before its job.
--
-- `entities` holds per-entity state, e.g.
--   {"clients": {"cursor": "abc", "synced": 400, "done": false}, ...}
--
-- ⚠ Deliberately NO percentage/ETA column. Jobber connections do expose
-- `totalCount`, but Jobber's own docs warn it "raises the likelyhood you will be
-- throttled", and a filtered probe needs a correctly-typed filter per entity —
-- exactly the shape of call that has repeatedly 400'd against this API. Progress is
-- reported as entities finished plus rows written until probe queries have been
-- verified live.
create table if not exists jobber_backfill_jobs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null unique references companies(id),
  status         text not null default 'pending',  -- pending|running|paused|completed|failed
  start_date     date not null,
  entities       jsonb not null default '{}'::jsonb,
  total_expected integer,
  total_synced   integer not null default 0,
  attempts       integer not null default 0,
  last_error     text,
  started_at     timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists jobber_backfill_jobs_active_idx
  on jobber_backfill_jobs (updated_at)
  where status in ('pending', 'running', 'paused');

-- Service-role only: RLS on with NO policies. Progress is surfaced through an
-- admin-gated API route, never read directly by a client.
alter table jobber_backfill_jobs enable row level security;
