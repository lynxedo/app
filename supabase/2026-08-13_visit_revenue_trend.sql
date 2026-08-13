-- Visit revenue over time — company, by service line, by technician.
--
-- The gap this fills: every money chart in the catalog is either a whole-window
-- total (Service Lines) or measures INVOICED money (Revenue & Invoicing's
-- "Invoiced vs Collected by Month"). Nothing showed what the crews actually
-- produced, month by month or week by week, broken down.
--
-- ⚠⚠ REVENUE IS REBUILT FROM LINE ITEMS, VERBATIM from scoreboard_techs_revenue.
-- `visits.total` is NULL on every completed visit, so the rules are copied rather
-- than re-invented, or this chart would disagree with the technician boards it
-- sits beside:
--   • recurring job  → SUM(line_items on the visit), excluding '%Service Plan%'
--   • one-off job    → job.total / (number of completed visits on that job)
--   • visits titled '%BILLING%' excluded; COMPLETED and not soft-deleted only
--
-- Three deliberate decisions, each measured against the live book first
-- (Heroes, 2026-01-01 → 2026-08-13, 2,923 completed visits, $429,475.33):
--
-- (1) ⚠⚠ THE COMPANY TOTAL DOES NOT FAN OUT PER TECHNICIAN, and the per-tech
--     series does. 20 visits (0.68%) carry more than one technician but
--     **$16,331.25 of revenue — 3.80% of the year**, because shared visits are the
--     big irrigation tickets. Crediting each technician and then summing would
--     report $445,806.58 against a true $429,475.33. So the totals and line series
--     are computed at VISIT level, and the per-tech series is computed separately
--     with the overlap reported back (`shared_visits` / `shared_revenue`) so a
--     stacked-by-tech chart can say why its bars overshoot instead of quietly
--     lying. `p_tech_credit='split'` divides a shared visit evenly instead, for
--     anyone who would rather the stack reconcile than match the tech boards.
--
-- (2) Department comes from the LINE ITEM first (`li.dept_prefix`), matching
--     scoreboard_techs_revenue. scoreboard_service_lines instead stamps one
--     department per visit from its first line item; measured, the two rules
--     disagree on **$56.25 of $208,726 recurring revenue (0.03%, 7 visits)**, and
--     the per-item rule is the more precise of the two — a visit carrying a lawn
--     treatment and a sprinkler repair splits correctly.
--
-- (3) ⚠ NO CLAMPING TO TIMECLOCK COVERAGE, unlike scoreboard_service_lines and
--     scoreboard_crew_labor. Those clamp because they divide revenue by labour
--     hours and a ratio must not span two sources with different coverage. This
--     function reports revenue only, so clamping would silently start a
--     year-to-date chart in late May — the §8.6 lesson applied in reverse.
--
-- Buckets use the business clock (America/Chicago), matching the date-range
-- resolver and scoreboard_service_lines. Measured: 0 of 2,923 visits currently
-- land in a different month or week than the UTC reading, so this changes no
-- number today; it is correct rather than corrective. Weeks start Monday, which
-- is the week scoreboard_crew_labor already uses for overtime.

create or replace function public.scoreboard_visit_revenue_trend(
  p_company_id  uuid,
  p_start       date,
  p_end         date,
  p_grain       text default 'month',
  p_tech_credit text default 'each'
) returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
with allowed as (
  select public.scoreboard_reports_allowed(p_company_id) ok
),
g as (
  select case when lower(coalesce(p_grain, 'month')) = 'week' then 'week' else 'month' end gr,
         case when lower(coalesce(p_tech_credit, 'each')) = 'split' then 'split' else 'each' end credit
),
vis as (
  select v.id,
         v.external_id,
         v.job_id,
         v.tech_external_user_ids techs,
         date_trunc((select gr from g), (v.completed_at at time zone 'America/Chicago')::date)::date b,
         j.dept_prefix jdept,
         j.title jtitle,
         j.is_recurring,
         j.total jtotal
  from visits v
  join jobs j on j.id = v.job_id and j.deleted_at is null
  where (select ok from allowed)
    and v.company_id = p_company_id
    and v.deleted_at is null
    and v.visit_status = 'COMPLETED'
    and (v.completed_at at time zone 'America/Chicago')::date between p_start and p_end
    and upper(coalesce(v.title, '')) not like '%BILLING%'
),
-- One row per (visit, department, amount). A recurring visit can contribute to
-- more than one department; a one-off contributes to exactly one.
rec as (
  select vis.id vid, vis.b, coalesce(li.dept_prefix, vis.jdept, 'Other') dept,
         li.total amt, vis.techs
  from vis
  join line_items li
    on li.parent_external_id = vis.external_id
   and li.parent_type = 'visit'
   and li.company_id = p_company_id
   and li.deleted_at is null
   and li.name not ilike '%Service Plan%'
  where vis.is_recurring
),
oneoff as (
  select vis.id vid, vis.b,
         coalesce(vis.jdept, substring(upper(coalesce(vis.jtitle, '')) from '^(WF|IR|PW|MO|LD)'), 'Other') dept,
         vis.jtotal / nullif(jc.n, 0) amt, vis.techs
  from vis
  join lateral (
    select count(*) n from visits v2
    where v2.job_id = vis.job_id and v2.deleted_at is null and v2.visit_status = 'COMPLETED'
  ) jc on true
  where not vis.is_recurring
),
parts as (
  select * from rec
  union all
  select * from oneoff
),
-- Company + per-line, both at visit level: no technician fan-out, so `lines`
-- always sums exactly to `periods` and a stacked-by-line chart is honest.
periods as (
  select b, sum(amt) total, count(distinct vid) visits
  from parts group by b
),
lines as (
  select b, dept, sum(amt) total
  from parts group by b, dept
),
-- Per technician. Each assigned tech is credited in full ('each', matching the
-- technician boards and scoreboard_techs_revenue) or given an even share
-- ('split', so the stack reconciles to the company total).
tech_parts as (
  select p.b, t.tid,
         case when (select credit from g) = 'split'
              then p.amt / nullif(array_length(p.techs, 1), 0)
              else p.amt end amt
  from parts p
  cross join lateral unnest(coalesce(p.techs, array[]::text[])) as t(tid)
),
techs as (
  select tp.b, tp.tid,
         coalesce(nullif(ju.name, ''), 'Unknown (' || left(tp.tid, 8) || ')') name,
         sum(tp.amt) total
  from tech_parts tp
  left join jobber_users ju on ju.company_id = p_company_id and ju.external_id = tp.tid
  group by tp.b, tp.tid, ju.name
),
-- What a per-tech chart cannot show, stated rather than hidden: revenue on
-- visits nobody is assigned to, and the overlap created by shared visits.
gaps as (
  select
    coalesce(sum(amt) filter (where coalesce(array_length(techs, 1), 0) = 0), 0) unattributed_revenue,
    count(distinct vid) filter (where coalesce(array_length(techs, 1), 0) = 0) unattributed_visits,
    count(distinct vid) filter (where coalesce(array_length(techs, 1), 0) > 1) shared_visits,
    coalesce(sum(amt * (coalesce(array_length(techs, 1), 1) - 1))
             filter (where coalesce(array_length(techs, 1), 0) > 1), 0) shared_overlap
  from parts
)
select jsonb_build_object(
  'grain',       (select gr from g),
  'tech_credit', (select credit from g),
  'start',       p_start,
  'end',         p_end,
  'total',       coalesce((select sum(total) from periods), 0),
  'periods',     coalesce((select jsonb_agg(jsonb_build_object('b', b, 'total', total, 'visits', visits) order by b) from periods), '[]'::jsonb),
  'lines',       coalesce((select jsonb_agg(jsonb_build_object('b', b, 'k', dept, 'total', total) order by b, dept) from lines), '[]'::jsonb),
  'techs',       coalesce((select jsonb_agg(jsonb_build_object('b', b, 'k', tid, 'name', name, 'total', total) order by b, name) from techs), '[]'::jsonb),
  -- Overlap is 0 when 'split' is in force, because splitting removes it.
  'shared_visits',        (select shared_visits from gaps),
  'shared_overlap',       case when (select credit from g) = 'split' then 0 else (select shared_overlap from gaps) end,
  'unattributed_revenue', (select unattributed_revenue from gaps),
  'unattributed_visits',  (select unattributed_visits from gaps)
)
where (select ok from allowed)
$function$;

-- ⚠ PUBLIC FIRST. A freshly created function carries the default PUBLIC EXECUTE
-- grant, so revoking `authenticated` by name is a no-op while PUBLIC still holds
-- it — the trap from 2026-08-12. Service-role only: the routes check the caller's
-- grant themselves and there is no second net below them.
revoke all on function public.scoreboard_visit_revenue_trend(uuid, date, date, text, text) from public;
revoke all on function public.scoreboard_visit_revenue_trend(uuid, date, date, text, text) from anon, authenticated;
grant execute on function public.scoreboard_visit_revenue_trend(uuid, date, date, text, text) to service_role;
