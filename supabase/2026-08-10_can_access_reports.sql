-- Reports section gate. Applied to the shared Supabase DB via MCP on 2026-08-10.
--
-- PRD §12's two-layer model starts here. Before this, /hub/reports was hardcoded to
-- `role = 'admin'` and no flag existed at all (§0.6). Defaults FALSE, and admins
-- bypass in code, so no admin loses access and no non-admin gains any.
alter table public.user_profiles
  add column if not exists can_access_reports boolean not null default false;

-- get_admin_users must return the new flag or the Admin -> People toggle can't read
-- it. Changing RETURNS TABLE needs a drop + recreate, and the new column is
-- APPENDED last so nothing positional shifts for any consumer.
--
-- ⚠⚠ A recreated SECURITY DEFINER function gets EXECUTE granted to PUBLIC by
-- Supabase default. That is exactly how four scoreboard functions ended up readable
-- by anon (see 2026-07-05_security_revoke_anon_access.sql). The revoke/grant pair
-- at the end restores the original ACL, verified after applying:
--   {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   anon EXECUTE = false, SECURITY DEFINER = true, search_path = public
--
-- ⚠ The full function body is in the applied migration `can_access_reports_2026_08_10`;
-- it is byte-identical to the previous definition plus `up.can_access_reports` at the
-- end of both the RETURNS TABLE and the SELECT. Read the live one with
-- pg_get_functiondef() before editing.
--
-- ⚠ CLAUDE.md lesson that applies here: get_admin_users results are typed `any`, so
-- widening the RPC requires hand-updating the mapping in app/hub/admin/page.tsx —
-- tsc cannot catch a missed field there.
