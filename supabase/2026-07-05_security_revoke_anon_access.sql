-- 2026-07-05 — Security hardening: revoke unauthenticated (anon / PUBLIC) access
-- Source: Supabase security advisor + live-DB grant audit during the July 5 2026 five-specialist review.
-- Apply ONCE to the shared Supabase DB (staging + prod share it). No app code deploy required;
-- takes effect immediately. STATUS: fully applied 2026-07-05 (steps 1-3 incl. the lead_monday_sync
-- DROP, which Ben explicitly confirmed after it was verified dead). The REVOKEs are reversible with a
-- matching GRANT; the DROP is not (table + its 553 fossil rows are gone).
--
-- Verified facts this migration is based on (has_function_privilege / has_table_privilege / pg_class.reloptions):
--   * 4 scoreboard SECURITY DEFINER fns had EXECUTE for anon (2 also for PUBLIC) -> unauthenticated
--     callers could pull per-tech revenue/hours by passing a company_id.
--   * products_with_cost is a view with NO security_invoker (runs as owner -> bypasses RLS) and anon
--     had SELECT -> product cost/pricing/EPA data exposed to anon.
--   * lead_monday_sync (dead Monday-mirror leftover) has RLS disabled and anon SELECT (553 rows;
--     lead_id/monday_item_id/timestamps only, no customer PII).
--   * hub_users_with_presence is anon-granted BUT has security_invoker=on, so anon reads return nothing
--     (safe). The stray grant is revoked below as belt-and-suspenders (optional).

begin;

-- 1) Lock the four scoreboard functions to signed-in users only.
--    This reproduces the correct ACL already used by get_admin_users / scoreboard_churn_summary
--    ({postgres, authenticated, service_role}); authenticated keeps its own explicit grant.
revoke execute on function public.scoreboard_board_technicians(p_company_id uuid, p_board_slug text)                                        from public, anon;
revoke execute on function public.scoreboard_ir_repair_ticket(p_company_id uuid, p_start date, p_end date)                                  from public, anon;
revoke execute on function public.scoreboard_techs_hours(p_company_id uuid, p_start date, p_end date, p_employee_ids uuid[])                from public, anon;
revoke execute on function public.scoreboard_techs_revenue(p_company_id uuid, p_start date, p_end date, p_bucket text, p_tech_external_ids text[]) from public, anon;

-- 2) Remove anon SELECT on the cost-exposing view. Authenticated staff legitimately read cost via
--    Pricer / Products admin, so authenticated is left in place.
revoke select on public.products_with_cost from anon;
--    Optional stronger fix — make the view respect the caller's RLS like hub_users_with_presence
--    already does (leave commented unless you want to verify the Pricer/Products pages still work):
--        alter view public.products_with_cost set (security_invoker = on);

-- 3) lead_monday_sync — dead table from the removed Monday mirror.
--    Confirmed dead July 5 2026: no code references it, no live Monday.com API integration remains,
--    and all 553 rows shared one bulk-backfill timestamp (2026-06-16 00:33) with zero writes since.
--    Applied: RLS enabled (lockdown), then DROPPED with Ben's explicit confirmation.
alter table public.lead_monday_sync enable row level security;
drop table public.lead_monday_sync;  -- APPLIED 2026-07-05 (Ben confirmed); table is gone.

-- 4) Optional hygiene — hub_users_with_presence is already safe (security_invoker=on); drop the
--    stray anon grant anyway:
-- revoke select on public.hub_users_with_presence from anon;

commit;

-- 5) Optional hardening (separate, not run here) — pin search_path on the 3 advisor-flagged functions.
--    Fetch exact signatures first, then:
--        alter function public.increment_web_search_usage(<args>)     set search_path = '';
--        alter function public.service_mapping_line_item_names(<args>) set search_path = '';
--        alter function public.email_job_line_item_options(<args>)    set search_path = '';
