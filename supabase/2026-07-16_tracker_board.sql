-- 2026-07-16_tracker_board.sql
-- Lead Tracker v2 "cockpit" views (Table + Board + Needs-me).
--
-- Additive only. Two columns:
--   1. leads.stage_changed_at — when a lead last moved stage. Powers the Board /
--      Needs-me "age in stage" and gives the drip stage_changed trigger + auto-move
--      (built by the integrator) a timestamp to stamp. Backfilled from the best
--      available existing timestamp so cards show a sane age on day one.
--   2. tracker_stages.system_role — optional pipeline semantics (new / responded /
--      quoted / won / lost). The Board tucks terminal (won/lost) stages behind a
--      "show closed" toggle, and drip campaigns can trigger off a stage's role.
--      At most one stage per company may hold a given role (partial unique index).
--
-- ⚠ Not yet applied. Deploy the app that selects leads.stage_changed_at only AFTER
--   this runs (the tracker loader selects the column explicitly).

-- ── leads.stage_changed_at ───────────────────────────────────────────────────
alter table leads add column if not exists stage_changed_at timestamptz;

-- Backfill existing rows so "age in stage" isn't blank on launch.
update leads
  set stage_changed_at = coalesce(updated_at, created_at, now())
  where stage_changed_at is null;

-- Board / Needs-me read leads by company + stage, ordered by recency.
create index if not exists leads_company_stage_changed_idx
  on leads (company_id, stage, stage_changed_at);

-- ── tracker_stages.system_role ───────────────────────────────────────────────
alter table tracker_stages add column if not exists system_role text;

-- One stage per role per company. Partial (NULLs excluded) so untagged stages
-- never collide; also lets the stages PATCH/POST "move" a role onto a stage after
-- clearing it off the previous holder.
create unique index if not exists tracker_stages_company_system_role_uniq
  on tracker_stages (company_id, system_role)
  where system_role is not null;
