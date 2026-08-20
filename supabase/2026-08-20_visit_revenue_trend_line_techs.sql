-- ===========================================================================
-- scoreboard_visit_revenue_trend: add the (service line x technician) cross-tab
-- 2026-08-20   APPLIED to the shared DB this session (two CREATE OR REPLACE steps,
--              collapsed here into the final definition).
--
-- Ben, building Lukas' board: "a widget that tells me the total revenue that the
-- irrigation department has done between reoccurring and one-off, and then I also
-- would like that to be narrowed down by technician as well in the filters."
--
-- ⚠ THE TOTAL WAS ALREADY RIGHT — this changes no existing number. `kpi_visit_revenue`
-- with the line filter on IR read $239,571.92 for 2026 YTD, and that was rebuilt by
-- hand from visits/jobs/line_items and matched to the cent: $197,249.17 one-off +
-- $42,322.75 recurring. It does span both halves of the book, because the two are
-- measured on different branches of this function (`rec` sums a recurring visit's line
-- items; `oneoff` spreads jobs.total across the job's completed visits).
--
-- What could NOT be built was the technician cut of that total. The payload carried
-- `lines` (bucket x dept) and `techs` (bucket x tech) as two roll-ups, each collapsing
-- the other's dimension, so no client-side arithmetic can recover dept-by-tech. Hence
-- one new key: `line_techs` (bucket, dept, tech, name, total).
--
-- ⚠⚠ ADDITIVE ONLY, PROVEN NOT ASSERTED. Every pre-existing key is byte-for-byte
-- unchanged: for each of (month/each, month/split, week/each) the new payload with
-- `line_techs` removed hashes to the same md5 as the old payload. That matters because
-- three shipped trend widgets and the commission cards read this source.
--
-- ⚠ `line_techs` derives from the SAME `tech_parts` CTE as `techs` rather than being a
-- parallel re-implementation of the rules — two independently written breakdowns of one
-- number is how a board ends up with a per-tech total that won't reconcile with the
-- per-line total for reasons nobody can find. `techs` itself was left textually
-- untouched (inline join, `group by ju.name`) so a future duplicate jobber_users row
-- could not make the two cuts diverge.
--
-- ⚠ It honours `p_tech_credit` exactly as `techs` does, and the consequence is the
-- headline caveat for any card built on it: with 'each', a visit worked by two people
-- credits both, so summing a line's technicians OVERSHOOTS that line's own total — for
-- IR on Heroes' 2026 book by $16,331.25 ($255,903.17 vs $239,571.92), because shared
-- visits are the big irrigation tickets. With 'split' it closes on `lines` to the cent
-- for EVERY department (verified: 0 lines off by more than half a cent).
--
-- ⚠ Unassigned work is INCLUDED, as a row with `k: null` and name 'Nobody assigned' —
-- the exact string the technician picker offers (NO_TECH in widgets/people-filter.ts).
-- Unassigned visits never enter `tech_parts` at all, since unnest of an empty array
-- yields no rows, so without this branch a card filtered to 'Nobody assigned' would
-- have read $0 while real money sat on those visits. Added as a UNION rather than by
-- changing `tech_parts`, because that CTE also feeds the shipped `techs` key. Those
-- amounts are NOT divided in 'split' mode — there is nobody to split between — which
-- is precisely what makes the split-mode sum close for every department rather than
-- only the ones with complete crew attribution.
--
-- ⚠ Measured today that branch is worth exactly $0.00: 2026 YTD has 7 completed
-- visits with nobody assigned and every one of them carries no revenue. So it is not
-- fixing a visible discrepancy right now -- it makes sure that when one of those visits
-- DOES carry money it lands somewhere a person can tick, instead of vanishing from a
-- technician-filtered card. Stated plainly so a later reader does not "verify" this
-- branch against a zero and conclude it is dead code.
--
-- Cardinality is small: 81 rows at month grain (5 lines x 10 techs x 8 buckets), 85 at
-- week grain over a quarter.
--
-- ACLs preserved by CREATE OR REPLACE and re-verified after: service_role only,
-- anon = false, authenticated = false.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.scoreboard_visit_revenue_trend(
  p_company_id uuid, p_start date, p_end date,
  p_grain text DEFAULT 'month'::text, p_tech_credit text DEFAULT 'each'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
rec as (
  select vis.id vid, vis.b, coalesce(li.dept_prefix, vis.jdept, 'Other') dept,
         li.total amt, vis.techs
  from vis
  join line_items li
    on li.parent_external_id = vis.external_id
   and li.parent_type = 'visit'
   and li.company_id = p_company_id
   and li.deleted_at is null
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
periods as (
  select b, sum(amt) total, count(distinct vid) visits
  from parts group by b
),
lines as (
  select b, dept, sum(amt) total
  from parts group by b, dept
),
-- Carries `dept` so `techs` and `line_techs` are two groupings of ONE set of rows.
tech_parts as (
  select p.b, p.dept, t.tid,
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
line_techs as (
  select tp.b, tp.dept, tp.tid,
         coalesce(nullif(ju.name, ''), 'Unknown (' || left(tp.tid, 8) || ')') name,
         sum(tp.amt) total
  from tech_parts tp
  left join jobber_users ju on ju.company_id = p_company_id and ju.external_id = tp.tid
  group by tp.b, tp.dept, tp.tid, ju.name
  union all
  -- The gap made tickable. See the header note.
  select p.b, p.dept, null::text tid, 'Nobody assigned' name, sum(p.amt) total
  from parts p
  where coalesce(array_length(p.techs, 1), 0) = 0
  group by p.b, p.dept
),
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
  'line_techs',  coalesce((select jsonb_agg(jsonb_build_object('b', b, 'd', dept, 'k', tid, 'name', name, 'total', total) order by b, dept, name) from line_techs), '[]'::jsonb),
  'shared_visits',        (select shared_visits from gaps),
  'shared_overlap',       case when (select credit from g) = 'split' then 0 else (select shared_overlap from gaps) end,
  'unattributed_revenue', (select unattributed_revenue from gaps),
  'unattributed_visits',  (select unattributed_visits from gaps)
)
where (select ok from allowed)
$function$;
