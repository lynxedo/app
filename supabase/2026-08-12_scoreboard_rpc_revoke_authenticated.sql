-- Close the direct door to the scoreboard/report data functions.
--
-- ⚠⚠ WHAT WAS WRONG
-- Every `scoreboard_*` function was EXECUTE-able by `authenticated`, and the only
-- check inside them was `scoreboard_reports_allowed()`, which passes for
--     admin OR can_access_reports OR can_access_scoreboards.
-- All nine Heroes users hold `can_access_scoreboards`. So the per-report grants
-- (`report_access`) and per-board grants (`scoreboard_board_access`) were enforced
-- in the app only: a technician granted boards 1 and 2 could POST directly to
-- /rest/v1/rpc/scoreboard_crew_labor and read every colleague's hours and labour
-- cost — from which the hourly rate is one division away — plus receivables and
-- the client list.
--
-- Proven on 2026-08-12 by impersonating a real technician in SQL
-- (set request.jwt.claims to their id): guard returned TRUE and the call returned
-- four colleagues' hours and pay. Not theoretical.
--
-- `anon` never had EXECUTE on any of these — verified across all 23 functions —
-- so this was never an unauthenticated exposure. It needed a real login.
--
-- ⚠ THE FIX
-- Revoke EXECUTE from `authenticated`, leaving the API routes as the single door.
-- Both routes already check grants correctly before fetching:
--   • /api/hub/reports/widgets      -> canSeeReport()          (report_access)
--   • /api/hub/scoreboards          -> getGrantedBoardSlugs()  (scoreboard_board_access)
-- and both derive company_id from the session's profile, never the request.
--
-- ⚠⚠ SEQUENCING — THIS MUST RUN LAST.
-- Staging and prod share this database. The app calls these functions with the
-- CALLER'S client until the matching code ships, so running this before that code
-- is live on BOTH environments breaks every report and scoreboard immediately.
-- Order: code -> staging (verify) -> code -> prod (verify) -> then this file.
--
-- ⚠ THE RULE THIS CREATES
-- There is no second net below the routes any more. Any new route that resolves
-- widgets or calls a scoreboard_* function MUST check the caller's grant first.
--
-- Rollback (re-opens the hole; only if a call site was missed):
--   do $$ declare r record; begin
--     for r in select p.oid::regprocedure sig from pg_proc p
--       join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.proname like 'scoreboard%'
--     loop execute format('grant execute on function %s to authenticated', r.sig); end loop;
--   end $$;

do $$
declare
  r record;
  n_revoked int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'scoreboard%'
  loop
    -- anon already holds nothing; named here so a future default-grant can't
    -- quietly reopen it (the Supabase trap where REVOKE ... FROM PUBLIC leaves
    -- the named roles untouched, and CREATE OR REPLACE re-grants).
    execute format('revoke execute on function %s from authenticated, anon', r.sig);
    -- The app calls these as service_role now. Stated explicitly rather than
    -- relied on, so a recreated function lands in a known state.
    execute format('grant execute on function %s to service_role', r.sig);
    n_revoked := n_revoked + 1;
  end loop;
  raise notice 'scoreboard_* functions locked to service_role: %', n_revoked;
end $$;

-- Verification (expect authenticated=false, service_role=true on every row):
--   select p.proname,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
--          has_function_privilege('service_role',  p.oid, 'EXECUTE') as svc_exec
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname like 'scoreboard%'
--   order by p.proname;
