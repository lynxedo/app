-- Date-range version of scoreboard_source_scorecard. Applied to the shared
-- Supabase DB via MCP on 2026-08-10.
--
-- WHY: the original takes p_year, so the widget board's date-range control could
-- only ever narrow to a calendar year — pick "July 1–15" and 8 of Board 8's 10
-- cards would silently report the whole year. A control that quietly ignores what
-- you chose is worse than no control.
--
-- The port is mechanical: p_year appeared in exactly three places, all of the form
-- `extract(year from X) = p_year`.
--
-- Semantics for a window [p_start, p_end]:
--   universe = services still Active, plus ones cancelled INSIDE the window
--   churned  = cancelled inside the window
--   new      = sold inside the window
--
-- ⚠ VERIFIED EQUIVALENT: over Jan 1 → today this returns byte-identical rows to
-- scoreboard_source_scorecard(company, 2026) — 14 rows each, zero differences in
-- either direction (checked with EXCEPT both ways), same totals (77 new / 373
-- customers). Migrating the widget board between them changed no number.
--
-- ⚠ The year version STAYS. It still backs the hardcoded Board 8 (?classic=1) and
-- the weekly snapshot cron's computeBoardPayload. Drop it only when both are gone.
--
-- ⚠ RETURNS TABLE is deliberately identical to the year version so both share one
-- TypeScript row type. That leaves the column named `new_in_year` while it means
-- "new within the window" — kept for signature compatibility, not correctness.
--
-- ⚠ SECURITY: Supabase grants EXECUTE to PUBLIC on a new function by default, so
-- the revokes below are load-bearing (see 2026-07-05_security_revoke_anon_access.sql,
-- where four scoreboard functions were found leaking to anon). Verified after
-- applying: ACL byte-identical to the year version —
-- {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}, anon has
-- no EXECUTE, SECURITY DEFINER, search_path pinned.
--
-- ⚠ PERF: this is the function that hit an 8,576 ms statement timeout in July
-- before its five functional indexes landed. Wide windows are the risk case.


create or replace function public.scoreboard_source_scorecard_range(
  p_company_id uuid, p_start date, p_end date
)
returns table(
  source text, source_group text, cost_type text, total_customers bigint,
  active_count bigint, churned_count bigint, retention_pct numeric,
  new_in_year bigint, active_annual_value numeric, avg_annual_value numeric,
  avg_tenure_months numeric, est_ltv numeric, unresolved_count bigint
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with gate as (
    select 1 where (select auth.uid()) is null
      or exists (
        select 1 from public.user_profiles up
        where up.id = (select auth.uid())
          and up.company_id = p_company_id
          and (up.role = 'admin' or up.can_access_scoreboards)
      )
  ),
  scope as (
    select rs.*,
      case
        when rs.cancelled_status = 'Cancelled'
         and rs.cancel_date >= p_start and rs.cancel_date <= p_end then 'churned'
        when rs.cancelled_status = 'Active' then 'active'
      end as bucket
    from public.recurring_services rs, gate
    where rs.company_id = p_company_id
      and (rs.cancelled_status = 'Active'
        or (rs.cancelled_status = 'Cancelled'
            and rs.cancel_date >= p_start and rs.cancel_date <= p_end))
  ),
  resolved as (
    select s.*,
      public.churn_resolve_source(p_company_id, s.lead_source, s.email, s.phone, s.name) as src,
      cl.external_created_at as client_since
    from scope s
    left join lateral (
      select c.external_created_at
      from public.clients c
      where c.company_id = p_company_id
        and (
          (coalesce(s.email,'') <> '' and lower(c.email) = lower(s.email))
          or (regexp_replace(coalesce(s.phone,''),'\D','','g') <> ''
              and regexp_replace(coalesce(c.phone,''),'\D','','g') = regexp_replace(s.phone,'\D','','g'))
        )
      order by (lower(c.email) = lower(coalesce(s.email,''))) desc
      limit 1
    ) cl on true
  )
  select
    coalesce(r.src, 'Other / Unknown')                                   as source,
    coalesce(max(m.source_group), 'Other')                               as source_group,
    coalesce(max(m.cost_type), 'Unknown')                                as cost_type,
    count(*)                                                             as total_customers,
    count(*) filter (where r.bucket = 'active')                          as active_count,
    count(*) filter (where r.bucket = 'churned')                         as churned_count,
    round(100.0 * count(*) filter (where r.bucket = 'active')
      / nullif(count(*), 0), 1)                                          as retention_pct,
    count(*) filter (where r.sold_date >= p_start and r.sold_date <= p_end) as new_in_year,
    coalesce(sum(r.annual_value) filter (where r.bucket = 'active'), 0)  as active_annual_value,
    round(avg(r.annual_value) filter (where r.bucket = 'active'), 0)     as avg_annual_value,
    round(avg(
      extract(epoch from (
        case when r.bucket = 'churned' then r.cancel_date::timestamptz else now() end
        - r.client_since
      )) / 2629800.0
    ) filter (where r.client_since is not null), 1)                      as avg_tenure_months,
    round(
      coalesce(avg(r.annual_value) filter (where r.bucket = 'active'), 0)
      * coalesce(avg(
          extract(epoch from (
            case when r.bucket = 'churned' then r.cancel_date::timestamptz else now() end
            - r.client_since
          )) / 2629800.0
        ) filter (where r.client_since is not null), 0) / 12.0
    , 0)                                                                 as est_ltv,
    count(*) filter (where r.src is null)                                as unresolved_count
  from resolved r
  left join public.lead_sources_master m
    on m.company_id = p_company_id and lower(m.master_source) = lower(coalesce(r.src, 'Other / Unknown'))
  group by coalesce(r.src, 'Other / Unknown')
  order by total_customers desc
$function$;

revoke all on function public.scoreboard_source_scorecard_range(uuid, date, date) from public;
revoke all on function public.scoreboard_source_scorecard_range(uuid, date, date) from anon;
grant execute on function public.scoreboard_source_scorecard_range(uuid, date, date) to authenticated;
grant execute on function public.scoreboard_source_scorecard_range(uuid, date, date) to service_role;
