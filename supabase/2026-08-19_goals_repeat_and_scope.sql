-- Applied to the shared DB on 2026-08-19 as migrations
--   report_goals_repeats_2026_08_19
--   scoreboard_goal_periods_2026_08_19
--   scoreboard_goals_use_period_expansion_2026_08_19   (an in-place patch; the result
--     is carried in 2026-08-19_goals_metric_expansion.sql, which is the record of the
--     whole function)
--
-- Ben: "for Period - It seems like we would need to set a goal for each month if we
-- choose month? That could come in handy but also very repetitive. It would be better
-- to set a Monthly goal that is the goal for each month."
--
-- A repeating target is a TEMPLATE. Its period_start is the first period it applies to
-- and the report expands it into one judged period per month/quarter/year from there
-- onward, so a monthly number is set once and every month is scored separately. A
-- one-off row for a specific period OVERRIDES the template covering it, which makes
-- "$50k every month, except $70k in October" two rows instead of twelve.
--
-- ⚠⚠ WHY THE EXPANSION IS ITS OWN FUNCTION. scoreboard_goals needs the expanded set
-- twice — once for the rows and once for the count behind the "only the N most recent
-- were read" note. Computing it twice from two copies of the same logic is how a
-- truncation note ends up disagreeing with the list it describes. It also makes the
-- expansion testable on its own, and taking `p_today` as a PARAMETER rather than
-- reading the clock means a test can ask what a board looked like on a given day.
--
-- ⚠ Only periods that have STARTED are expanded. A monthly target set in August must
-- not fill a year-to-date board with rows reading "Not started" — that buries the
-- months you can act on.
--
-- ⚠⚠ INDEX SEQUENCING, the trap the per-person goals migration already hit once: the
-- DEPLOYED route infers its upsert conflict target from a unique index, so the old
-- 5-column index CANNOT be dropped until the new code is live on both environments.
-- Both exist meanwhile. `repeats` joins the key so a standing monthly target and an
-- override for its own first month can coexist; until the old index goes, that one
-- combination returns a 409 that says so rather than a raw 500.
--
-- ✅ FOLLOW-UP DONE the same day, as report_goals_drop_old_scope_index_2026_08_19,
-- once the new code was live on prod (main 4a78a944) and staging (develop f3d21e70)
-- and both served builds were verified:
--     drop index if exists report_goals_scope_unique;
-- Guarded to refuse unless the replacement index existed, so it could not leave the
-- table with no unique key. Proven afterwards: the route's 6-column upsert target
-- resolves, re-saving a target replaces rather than duplicates, and a template plus an
-- override for its own first month now coexist.

alter table report_goals
  add column if not exists repeats boolean not null default false;

comment on column report_goals.repeats is
  'True = a template applying to every period of this grain from period_start onward. '
  'period_start/period_end still describe the FIRST period, so nothing that reads a '
  'single period needs to know about repetition. A non-repeating row for the same '
  'metric/grain/period/person wins over the template.';

create unique index if not exists report_goals_scope_repeat_unique
  on report_goals (company_id, metric, grain, period_start, employee_id, repeats)
  nulls not distinct;

create or replace function public.scoreboard_goal_periods(
  p_company_id uuid, p_start date, p_end date, p_today date
) returns table (
  goal_id uuid, metric text, grain text,
  period_start date, period_end date, target numeric,
  employee_id uuid, repeating boolean
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with base as (
    select r.id, r.metric, r.grain, r.period_start, r.period_end, r.target, r.employee_id,
           coalesce(r.repeats, false) as is_repeating,
           case r.grain when 'month' then interval '1 month'
                        when 'quarter' then interval '3 months'
                        else interval '1 year' end as iv,
           case r.grain when 'month' then 'month'
                        when 'quarter' then 'quarter'
                        else 'year' end as unit
    from report_goals r
    where r.company_id = p_company_id
      and case when coalesce(r.repeats, false)
               -- A template applies from its first period ONWARD, so it only has to
               -- have started by the end of the window -- unlike a one-off, which has
               -- to overlap it.
               then r.period_start <= p_end
               else r.period_start <= p_end and r.period_end >= p_start
          end
  ),
  expanded as (
    select b.id, b.metric, b.grain, b.period_start, b.period_end, b.target, b.employee_id,
           false as repeating
    from base b
    where not b.is_repeating
    union all
    -- One row per period of this grain, aligned to the template's own boundaries (the
    -- API always stores an aligned period_start, so stepping by the grain's interval
    -- stays aligned).
    select b.id, b.metric, b.grain,
           gs::date,
           (gs + b.iv - interval '1 day')::date,
           b.target, b.employee_id, true
    from base b
    cross join generate_series(
      greatest(b.period_start, date_trunc(b.unit, p_start::timestamp)::date)::timestamp,
      -- ⚠ Bounded by TODAY as well as the window: expanding into periods that have not
      -- begun would fill a year-to-date board with rows reading "Not started", which
      -- buries the months you can actually act on.
      least(p_end, p_today)::timestamp,
      b.iv
    ) gs
    where b.is_repeating
  )
  select e.id, e.metric, e.grain, e.period_start, e.period_end, e.target, e.employee_id, e.repeating
  from expanded e
  -- ⚠ A target set for ONE specific period beats the template covering it, which is
  -- what makes "$50k every month, except December" two rows instead of twelve.
  where not e.repeating
     or not exists (
       select 1 from report_goals o
       where o.company_id = p_company_id
         and o.metric = e.metric
         and o.grain = e.grain
         and o.period_start = e.period_start
         and o.employee_id is not distinct from e.employee_id
         and coalesce(o.repeats, false) = false
     )
$function$;

-- Locked down like every other reporting function: the caller is scoreboard_goals,
-- which is SECURITY DEFINER, so nothing else needs to execute this. ⚠ PUBLIC first --
-- a fresh function carries the default PUBLIC grant, so revoking anon and
-- authenticated by name alone would be a no-op.
revoke all on function public.scoreboard_goal_periods(uuid, date, date, date) from public;
revoke all on function public.scoreboard_goal_periods(uuid, date, date, date) from anon;
revoke all on function public.scoreboard_goal_periods(uuid, date, date, date) from authenticated;
