-- ============================================================================
-- Phase 8.7 — AI7: atomic web-search day-counter (shared prod+staging DB).
-- ADDITIVE ONLY (one new function). No table/column changes, no data touched.
-- Backup first if you like:
--   https://supabase.com/dashboard/project/nhvwdulyzolevoeayjum/database/backups
-- ============================================================================
--
-- Replaces the read-modify-write in lib/guardian-audit.ts (which lost
-- increments when two Guardian requests raced on the same day) with a single
-- atomic INSERT ... ON CONFLICT DO UPDATE. The (company_id, date) UNIQUE key
-- already exists (guardian_web_search_usage_company_id_date_key), so the
-- ON CONFLICT target is valid.

create or replace function public.increment_web_search_usage(
  p_company_id uuid,
  p_date date,
  p_delta integer
) returns integer
  language sql
as $function$
  insert into public.guardian_web_search_usage (company_id, date, count)
  values (p_company_id, p_date, p_delta)
  on conflict (company_id, date)
  do update set count = public.guardian_web_search_usage.count + excluded.count
  returning count;
$function$;

-- Locked to the server's service-role admin client (the only caller). Regular
-- app users (anon/authenticated) can't run it — they also can't write the table
-- directly (RESTRICTIVE deny-all RLS), so this keeps the surface consistent.
revoke all on function public.increment_web_search_usage(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.increment_web_search_usage(uuid, date, integer) to service_role;
