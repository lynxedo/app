-- Remove Heroes' company id as a COLUMN DEFAULT. PARTIALLY APPLIED 2026-08-12.
--
-- Eleven tables carried `company_id uuid NOT NULL DEFAULT
-- '00000000-0000-0000-0000-000000000002'` — one tenant's id, as the fallback for
-- everyone. A second tenant's rows land in Heroes wherever an insert omits it.
--
-- ⚠⚠ THE CONSTRAINT THAT SHAPES THIS MIGRATION: staging and production share ONE
-- database, and production runs `main`. So dropping a default does not take effect
-- "on staging" — it takes effect on PROD's code immediately, whatever branch the
-- fix happens to be sitting on. And because the column is NOT NULL, an insert that
-- relied on the default does not degrade, it throws.
--
-- Worst case found: `time_punches` is clock in/out, and app/api/timesheet/punch
-- CATCHES the failure, returns HTTP 200 with a soft warning and DMs the timesheet
-- admins. Clock-out would appear to succeed while recording nobody's hours. That is
-- precisely the failure shape this codebase keeps getting bitten by — absent looks
-- identical to fine.
--
-- So this is deliberately TWO PHASES.
--
-- ── PHASE 1 — APPLIED 2026-08-12 ────────────────────────────────────────────────
-- Six tables whose every insert path was audited AND whose insert sites were
-- verified byte-identical on `origin/main` (what prod actually runs), so the drop
-- could not surprise production:

alter table jobber_tokens        alter column company_id drop default;  -- OAuth callback, from user_profiles
alter table qbo_tokens           alter column company_id drop default;  -- OAuth callback, from the state param
alter table responder_calls      alter column company_id drop default;  -- explicit const
alter table responder_settings   alter column company_id drop default;  -- explicit, from the caller
alter table timesheet_settings   alter column company_id drop default;  -- no insert path exists at all
alter table user_profiles        alter column company_id drop default;  -- auth trigger, already correct

-- Note on user_profiles: the `on_auth_user_created` trigger resolves the company by
-- matching the signup email domain against companies.google_domain, and is wrapped
-- in `IF v_company_id IS NOT NULL` — so on no match it inserts NOTHING rather than
-- silently defaulting someone into Heroes. It was already written correctly.
--
-- ── PHASE 2 — NOT YET APPLIED. Blocked on prod, not on code. ────────────────────
-- Five tables still defaulted. The code fixes ship with this commit, but the DDL
-- must wait until that code is LIVE ON PROD:
--
--   time_punches   5 insert sites: punch (clock in/out), auto-clock-out,
--                  admin/day x2, admin/punches
--   time_entries   lib/timesheet-recompute.ts — the single derived-payroll writer,
--                  reached from 5 callers
--   employees      app/api/timesheet/employees POST ("Add employee")
--   user_settings  app/api/settings POST
--   call_logs      ⚠ SEQUENCE THIS ONE FIRST — see below
--
-- What the fixes do, and why each takes the company from where it does:
--   punch          from the EMPLOYEE's record, not the actor's — an admin punching
--                  on someone's behalf must not stamp their own company
--   auto-clock-out from the IN punch being closed — a cron needs no company context
--   time_entries   from the punch the entry is derived from — no extra query, and it
--                  belongs to whoever the punch belonged to
--   admin/day,     from the caller's profile, which both routes have ALREADY proved
--   admin/punches  the target employee belongs to
--   employees      from the caller's profile, mirroring the roster route
--   user_settings  from the caller's own profile (own-row write)
--
-- ⚠⚠ call_logs LIVES OUTSIDE THE DEPLOY PIPELINE. It is written by the Unitel call
-- script from /opt/unitel-script/ on the VPS (`Call System/src/supabase.js`
-- buildCallLogRow). That codebase has NO concept of a tenant — grep for company_id
-- returns zero hits — so it needs `company_id: process.env.SUPABASE_COMPANY_ID` plus
-- the var set in /opt/unitel-script/.env. A `git push` will NOT fix it, and the Drive
-- copy is only a reference copy. Fix on the VPS BEFORE this DDL.
--
-- ⚠ Also worth a look while in there: the newest call_logs row is 2026-06-26, seven
-- weeks stale, while responder_calls (the Twilio path) is current. Either that cron
-- has silently died or the Unitel line was retired and the docs are stale. Unknown
-- from read-only access — check `crontab -l` and /var/log/unitel-script/cron.log.
--
-- ── Out of scope, found while auditing ─────────────────────────────────────────
-- The responder reconcile cron is hardcoded to a single tenant
-- (app/api/dialer/responder/reconcile/route.ts:5-6, :152), so a second tenant's
-- responder traffic logs to Heroes regardless of any column default. Separate fix.
