-- ═══════════════════════════════════════════════════════════════════════════════
-- INSTALL LABOR CREDITS — per-technician credit for multi-day installs
-- Applied to prod 2026-08-20 as three migrations:
--   install_labor_credits_table_2026_08_20
--   per_tech_revenue_reads_install_labor_credits_2026_08_20
--   trend_shared_overlap_excludes_credited_installs_2026_08_20
--
-- THE PROBLEM. Lucas's Labor Cost % card read 32.0% on $75,600 of credited revenue,
-- while Ben's Jobber report showed $86,985 for the same person. Neither was right:
--   · Jobber's figure credits the FULL job total to every tech who touched it, so
--     Angel and Lucas were each credited the whole $10,925 Lukasek install. Summed
--     across the crew that reports $167,351 of work from $64,440 of revenue.
--   · Ours divided a one-off job's total by its COMPLETED VISIT COUNT and gave Lucas
--     only the visits he was named on. Defensible, except Jobber records one
--     completion date per install and usually names one technician, so the helper on
--     a week-long two-man install looked like one day of work.
-- Diagnosed further: Lucas was paid nine full weeks in Jan-Feb (~$5,631) against 15
-- visits worth $4,601 — Jan read 114%, Feb 130%, while Mar-Aug read 26%. Company-wide
-- only 20 of 2,959 completed visits carry more than one technician, which for a shop
-- running two-man irrigation installs is not credible. The data cannot be fixed inside
-- the mirror, because the mirror is faithful to what Jobber holds.
--
-- THE FIX. `install_labor_credits` carries Ben's reconstruction from the Captivated
-- text archive — every on-my-way / arrived / done-for-today message to an install
-- customer establishes an on-site day; revenue spreads evenly across those days; each
-- day splits by heads present. 18 jobs, 48 on-site days, 131 person-rows, $64,440.50.
-- Result: Angel $21,718 (33.7%) · Wilson $21,718 (33.7%) · Lucas $19,338 (30.0%) ·
-- Mike $1,666 (2.6%). Labor Cost %: Lucas 32.0% -> 26.4%, Angel 18.1% -> 27.1%.
--
-- ⚠ WHY NOT EDIT visits.tech_external_user_ids. lib/jobber-sync.ts sets that column
-- from Jobber's assignedUsers on every run. Any edit there is erased on the next sync.
--
-- ⚠ WHY NOT JUST ADD THE NAMES IN JOBBER. 16 of the 18 jobs are a SINGLE visit, and the
-- scoreboard credits a visit's full value to every tech named on it. Fractional credit
-- is the whole point, and only a table can carry a fraction.
--
-- ⚠ BEN'S CREW RULE (2026-08-20): Wilson was on site whenever Angel was, with NO
-- hire-date bound. That reproduces the spreadsheet exactly from 2026-02-09 onward and
-- extends it back over the four earliest installs. Consequence he accepted knowingly:
-- Wilson's first payroll_periods row is 2026-05-25, so for Dec-May he has install
-- revenue and no cost, and HIS OWN Labor Cost % reads artificially low (14.3%). Nobody
-- else's figures are affected. Loading his contractor pay is what fixes it.
--
-- ⚠ NOT COVERED. Job #2034 Dylan Hall ($6,860) has no text evidence — the Captivated
-- export ends 2026-07-10 — so it keeps the visit-based split. Same for later installs.
-- This table is a fixed historical correction, NOT a running process: new installs need
-- the whole crew assigned in Jobber at the time.
--
-- ⚠ VERIFIED. Every company-level figure was hash-compared before and after and came
-- back IDENTICAL: crew_labor revenue / visits / labor_cost / rev_per_hour /
-- rev_per_visit / labor_pct / hours / commission / by_department, and trend
-- total / periods / lines across month-each, month-split and week-each.
--
-- ⚠ A BUG THIS CHANGE CAUSED AND FIXED, worth remembering. `gaps` in the trend function
-- fed the widget's honesty line ("the bars total MORE than company revenue by $X") and
-- read raw visits, so it kept counting job #1638's two-tech visit after that job stopped
-- double-counting. It printed $16,331.25 against a real overshoot of $15,333.77. The one
-- sentence whose entire job is to state how much the chart overstates was itself
-- overstating, by $997. Credited jobs are now excluded from `gaps`. THE LESSON: when you
-- change an attribution rule, every diagnostic that describes the OLD rule becomes a
-- confident lie — grep for the diagnostics, not just the maths.
--
-- The table DDL lives in migration install_labor_credits_table_2026_08_20; the 131 data
-- rows were generated from the sheet's head counts (not hand-copied dollars) and verified
-- two independent ways — Lucas's total matched the sheet to the dollar, and the row count
-- came to 131 on its own. Below is the wiring as applied.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Per-tech revenue reads install_labor_credits instead of the flat visit split.
--
-- Ben, 2026-08-20. Jobber records ONE completion date per install and usually ONE
-- technician, so no per-tech figure derived from the mirror can be right: the visit
-- split under-credits the helper, and naming everyone on a single visit credits the
-- job several times over. install_labor_credits carries the fractional truth,
-- reconstructed from the Captivated text archive (18 jobs, 48 on-site days, $64,440).
--
-- ⚠⚠ WHAT MUST NOT CHANGE. Only PER-TECH attribution moves. Every company-level figure
-- is computed from the same CTEs as before and must come out byte-identical:
--   scoreboard_crew_labor        -> revenue, visits, rev_per_hour, rev_per_visit, labor_pct
--   scoreboard_visit_revenue_trend -> total, periods, lines
-- The credits sum to their jobs' totals, so per-tech figures now reconcile to the
-- company figure INSTEAD OF overshooting it. That is the point.
--
-- ⚠ CREDITS ARE MODE-INDEPENDENT. scoreboard_visit_revenue_trend takes p_tech_credit
-- 'each' | 'split'. A credit row is ALREADY one person's share of one day, so it is used
-- as-is under both modes — there is no "each vs split" question about a number that is
-- already a fraction. Consequence worth knowing: under 'each', credited installs no
-- longer inflate the tech totals while everything else still does.
--
-- ⚠ ONE RULE, FOUR CALLERS. The exclusion predicate and the credits branch are written
-- the same way in all four functions. If a fifth per-tech function is ever added it must
-- do the same, or two cards will disagree about the same technician.
--
-- Audited 2026-08-20 — every scoreboard_* function that touches tech_external_user_ids:
--   scoreboard_crew_labor            ✓ credits wired
--   scoreboard_tech_revenue          ✓ credits wired
--   scoreboard_techs_revenue         ✓ credits wired
--   scoreboard_visit_revenue_trend   ✓ credits wired (techs, line_techs AND gaps)
--   scoreboard_service_lines         — DELIBERATELY NOT WIRED. It reads tech ids only to
--     spread LABOUR COST across service lines per tech-day; it never produces a
--     per-technician revenue figure, so there is nothing here for it to override. It
--     does still carry the separate flat-rate labour defect noted in
--     2026-08-20_labor_cost_includes_commission.sql.
-- scoreboard_people does NOT read tech ids at all — its labour figure comes through
-- crew_labor, so the per-person `labor_pct` goal added the same day inherits this fix.

-- ── 1. scoreboard_crew_labor ────────────────────────────────────────────────────
-- Only tech_rev changes: drop credited jobs from the visit-based path, add the credit
-- rows. `revenue`/`visits`/`labor_pct` come from visit_rev and totals, untouched.
create or replace function public.scoreboard_crew_labor(p_company_id uuid, p_start date, p_end date)
 returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  with allowed as (select public.scoreboard_reports_allowed(p_company_id) ok),
  tc as (
    select min(te.date) first_day, max(te.date) last_day
    from time_entries te join employees e on e.id = te.employee_id
    where te.company_id = p_company_id and te.total_hours > 0
      and e.is_field_labor and e.pay_type = 'hourly'
  ),
  pay as (
    select min(period_start) pay_first, max(period_end) pay_last
    from payroll_periods
    where company_id = p_company_id and coalesce(flsa_status,'') <> 'Exempt'
  ),
  bounds as (
    select least(coalesce(tc.first_day, pay.pay_first), coalesce(pay.pay_first, tc.first_day)) data_first,
           least(coalesce(tc.last_day, pay.pay_last), coalesce(pay.pay_last, tc.last_day)) data_last,
           pay.pay_last, tc.last_day tc_last, tc.first_day tc_first
    from tc, pay
  ),
  eff as (
    select greatest(p_start, b.data_first) s, least(p_end, b.data_last) e,
           b.data_first, b.data_last, b.pay_last, b.tc_last, b.tc_first from bounds b
  ),
  tc_hours as (
    select te.employee_id, sum(te.total_hours) hours
    from time_entries te, eff
    where te.company_id = p_company_id and te.total_hours > 0
      and te.date between greatest(eff.s, coalesce(eff.tc_first, eff.s)) and eff.e
    group by 1
  ),
  pr_hours_pre as (
    select pp.employee_id, sum((pp.regular_hours + pp.overtime_hours) * f.frac) hours
    from payroll_periods pp, eff
    cross join lateral (
      select greatest(0, (least(pp.period_end, least(eff.e, coalesce(eff.tc_first, eff.e) - 1))
             - greatest(pp.period_start, eff.s) + 1))::numeric
             / nullif(pp.period_end - pp.period_start + 1, 0) as frac
    ) f
    where pp.company_id = p_company_id and coalesce(pp.flsa_status,'') <> 'Exempt'
      and eff.tc_first is not null
      and pp.period_start <= least(eff.e, eff.tc_first - 1)
      and pp.period_end >= eff.s and f.frac > 0
    group by pp.employee_id
  ),
  pr_cost as (
    select pp.employee_id, sum(pp.wages_cost * f.frac) cost,
           sum(coalesce(pp.commission,0) * f.frac) commission,
           sum((pp.regular_hours + pp.overtime_hours) * f.frac) paid_hours
    from payroll_periods pp, eff
    cross join lateral (
      select greatest(0, (least(pp.period_end, eff.e) - greatest(pp.period_start, eff.s) + 1))::numeric
             / nullif(pp.period_end - pp.period_start + 1, 0) as frac
    ) f
    where pp.company_id = p_company_id and coalesce(pp.flsa_status,'') <> 'Exempt'
      and pp.period_start <= eff.e and pp.period_end >= eff.s and f.frac > 0
    group by pp.employee_id
  ),
  people_raw as (
    select e.id,
      coalesce(nullif(e.preferred_name,''), e.first_name) || ' ' || e.last_name as name,
      coalesce(nullif(e.department,''), 'Unassigned') as department,
      e.pay_type, e.hourly_rate, e.is_active,
      coalesce(t.hours, 0) + coalesce(hp.hours, 0) as hours,
      round(coalesce(c.cost, 0), 2) as labor_cost,
      round(coalesce(c.commission, 0), 2) as commission,
      (select ju.external_id from jobber_users ju
        where ju.company_id = e.company_id and ju.name ilike '%' || e.last_name || '%'
          and (ju.name ilike '%' || e.first_name || '%'
               or (nullif(e.preferred_name,'') is not null and ju.name ilike '%' || e.preferred_name || '%'))
        order by ju.is_active desc nulls last, ju.external_id limit 1) as jobber_id
    from employees e
    left join tc_hours t on t.employee_id = e.id
    left join pr_hours_pre hp on hp.employee_id = e.id
    left join pr_cost c on c.employee_id = e.id
    where e.company_id = p_company_id and e.is_field_labor
      and (t.employee_id is not null or hp.employee_id is not null or c.employee_id is not null)
  ),
  people as (
    select pr.*, (pr.hours >= 1 and pr.jobber_id is not null and pr.labor_cost > 0) as rankable
    from people_raw pr
  ),
  vis as (
    select v.id, v.external_id, v.job_id, v.tech_external_user_ids, v.completed_at
    from visits v, eff
    where v.company_id = p_company_id and v.deleted_at is null
      and v.visit_status = 'COMPLETED' and v.completed_at::date between eff.s and eff.e
      and upper(coalesce(v.title,'')) not like '%BILLING%'
  ),
  rev_recurring as (
    select v.id visit_id, sum(li.total) amt from vis v
    join jobs j on j.id = v.job_id and j.deleted_at is null and j.is_recurring = true
    join line_items li on li.parent_external_id = v.external_id and li.parent_type = 'visit'
      and li.company_id = p_company_id and li.deleted_at is null
    group by v.id
  ),
  rev_oneoff as (
    select v.id visit_id, (j.total / nullif(jc.n,0)) amt from vis v
    join jobs j on j.id = v.job_id and j.deleted_at is null and j.is_recurring = false
    join lateral (select count(*) n from visits v2 where v2.job_id = j.id
                  and v2.deleted_at is null and v2.visit_status='COMPLETED') jc on true
  ),
  visit_rev as (select visit_id, amt from rev_recurring union all select visit_id, amt from rev_oneoff),
  -- ⚠ NEW. Jobs whose per-tech split is hand-built. Company revenue still comes from
  -- visit_rev above, so excluding them HERE changes attribution only, never the total.
  credited_jobs as (
    select distinct job_id from install_labor_credits where company_id = p_company_id
  ),
  tech_rev_parts as (
    select t.tid, vr.amt
    from (select distinct jobber_id tid from people where jobber_id is not null) t
    join vis v on t.tid = any(v.tech_external_user_ids)
    join visit_rev vr on vr.visit_id = v.id
    where not exists (select 1 from credited_jobs cj where cj.job_id = v.job_id)
    union all
    -- credit_date, not on_site_date: the credit must land in the same window as the
    -- revenue it came out of (job #1133 was worked Dec 2025, invoiced 2026-01-02).
    select c.jobber_user_external_id, c.credit_amount
    from install_labor_credits c, eff
    where c.company_id = p_company_id
      and c.credit_date between eff.s and eff.e
      and c.jobber_user_external_id is not null
  ),
  tech_rev as (select tid, sum(amt) amt from tech_rev_parts group by tid),
  totals as (
    select (select round(sum(hours),1) from people) hours,
           (select round(sum(labor_cost),2) from people) labor_cost,
           (select round(sum(commission),2) from people) commission,
           (select round(sum(amt),2) from visit_rev) revenue,
           (select count(*) from vis) visits
  )
  select case when not (select ok from allowed) then null else jsonb_build_object(
    'coverage', jsonb_build_object(
      'timeclock_first', (select data_first from eff), 'timeclock_last', (select data_last from eff),
      'effective_start', (select s from eff), 'effective_end', (select e from eff),
      'requested_start', p_start, 'requested_end', p_end,
      'clamped', (select (s <> p_start or e <> p_end) from eff),
      'has_data', (select (s <= e) from eff),
      'backfilled', true, 'backfill_until', (select tc_first - 1 from eff),
      'payroll_through', (select pay_last from eff),
      'unpaid_tail_days', (select greatest(0, tc_last - pay_last) from eff),
      'install_credits_applied', (select count(*) from install_labor_credits c, eff
                                  where c.company_id = p_company_id and c.credit_date between eff.s and eff.e)
    ),
    'hours', coalesce((select hours from totals), 0),
    'labor_cost', coalesce((select labor_cost from totals), 0),
    'commission', coalesce((select commission from totals), 0),
    'revenue', coalesce((select revenue from totals), 0),
    'visits', coalesce((select visits from totals), 0),
    'rev_per_hour', (select case when hours > 0 then round(revenue / hours, 2) end from totals),
    'rev_per_visit',(select case when visits > 0 then round(revenue / visits, 2) end from totals),
    'labor_pct', (select case when revenue > 0 then round(100 * labor_cost / revenue, 1) end from totals),
    'unattributed_count', (select count(*) from people where jobber_id is null),
    'unattributed_hours', coalesce((select round(sum(hours),1) from people where jobber_id is null), 0),
    'unattributed_names', coalesce((select jsonb_agg(name order by hours desc) from people where jobber_id is null), '[]'::jsonb),
    'salaried_note', (select count(*) from employees where company_id = p_company_id and pay_type <> 'hourly' and is_active),
    'people', coalesce((select jsonb_agg(p order by (p->>'hours')::numeric desc) from (
        select jsonb_build_object('employee_id', pe.id, 'name', pe.name, 'department', pe.department,
          'is_active', pe.is_active, 'pay_type', pe.pay_type, 'hours', round(pe.hours, 1),
          'labor_cost', pe.labor_cost, 'commission', pe.commission,
          'attributable', (pe.jobber_id is not null), 'rankable', pe.rankable,
          'revenue', case when pe.jobber_id is not null then round(coalesce(tr.amt, 0), 2) end,
          'rev_per_hour', case when pe.rankable then round(coalesce(tr.amt,0) / pe.hours, 2) end) p
        from people pe left join tech_rev tr on tr.tid = pe.jobber_id) x), '[]'::jsonb),
    'by_department', coalesce((select jsonb_agg(d order by (d->>'hours')::numeric desc) from (
        select jsonb_build_object('department', department, 'hours', round(sum(hours), 1),
          'labor_cost', round(sum(labor_cost), 2), 'people', count(*)) d
        from people group by department) y), '[]'::jsonb)
  ) end;
$function$;

revoke all on function public.scoreboard_crew_labor(uuid, date, date) from public, anon;
grant execute on function public.scoreboard_crew_labor(uuid, date, date) to authenticated, service_role;


-- ── 2. scoreboard_tech_revenue (one technician, bucket x dept) ──────────────────
create or replace function public.scoreboard_tech_revenue(p_company_id uuid, p_start date, p_end date, p_bucket text, p_tech_external_id text)
 returns table(bucket date, dept text, total numeric)
 language sql security definer set search_path to 'public', 'pg_temp'
as $function$
  WITH allowed AS (
    SELECT ((SELECT auth.uid()) IS NULL OR EXISTS (
      SELECT 1 FROM user_profiles up WHERE up.id=(SELECT auth.uid())
        AND up.company_id=p_company_id AND (up.role='admin' OR up.can_access_scoreboards))) AS ok
  ),
  recurring AS (
    SELECT date_trunc(CASE WHEN p_bucket='week' THEN 'week' ELSE 'month' END, v.completed_at)::date AS bucket,
           COALESCE(li.dept_prefix, j.dept_prefix, 'Other') AS dept, li.total AS amt
    FROM visits v
    JOIN jobs j ON j.id=v.job_id AND j.deleted_at IS NULL AND j.is_recurring=true
    JOIN line_items li ON li.parent_external_id=v.external_id AND li.parent_type='visit'
      AND li.company_id=p_company_id AND li.deleted_at IS NULL
    WHERE v.company_id=p_company_id AND v.deleted_at IS NULL AND v.visit_status='COMPLETED'
      AND v.completed_at::date BETWEEN p_start AND p_end AND UPPER(COALESCE(v.title,'')) NOT LIKE '%BILLING%'
      AND p_tech_external_id = ANY(v.tech_external_user_ids)
  ),
  oneoff AS (
    SELECT date_trunc(CASE WHEN p_bucket='week' THEN 'week' ELSE 'month' END, v.completed_at)::date AS bucket,
           COALESCE(j.dept_prefix, substring(UPPER(COALESCE(j.title,'')) from '^(WF|IR|PW|MO|LD)'), 'Other') AS dept,
           j.total / NULLIF(jc.n,0) AS amt
    FROM visits v
    JOIN jobs j ON j.id=v.job_id AND j.deleted_at IS NULL AND j.is_recurring=false
    JOIN LATERAL (SELECT count(*) n FROM visits v2 WHERE v2.job_id=j.id AND v2.deleted_at IS NULL AND v2.visit_status='COMPLETED') jc ON true
    WHERE v.company_id=p_company_id AND v.deleted_at IS NULL AND v.visit_status='COMPLETED'
      AND v.completed_at::date BETWEEN p_start AND p_end AND UPPER(COALESCE(v.title,'')) NOT LIKE '%BILLING%'
      AND p_tech_external_id = ANY(v.tech_external_user_ids)
      -- ⚠ hand-built credits win for these jobs
      AND NOT EXISTS (SELECT 1 FROM install_labor_credits c WHERE c.company_id=p_company_id AND c.job_id=j.id)
  ),
  credits AS (
    SELECT date_trunc(CASE WHEN p_bucket='week' THEN 'week' ELSE 'month' END, c.credit_date)::date AS bucket,
           COALESCE(j.dept_prefix, substring(UPPER(COALESCE(j.title,'')) from '^(WF|IR|PW|MO|LD)'), 'Other') AS dept,
           c.credit_amount AS amt
    FROM install_labor_credits c JOIN jobs j ON j.id=c.job_id
    WHERE c.company_id=p_company_id AND c.credit_date BETWEEN p_start AND p_end
      AND c.jobber_user_external_id = p_tech_external_id
  )
  SELECT t.bucket, t.dept, SUM(t.amt) AS total
  FROM (SELECT bucket,dept,amt FROM recurring WHERE (SELECT ok FROM allowed)
        UNION ALL SELECT bucket,dept,amt FROM oneoff WHERE (SELECT ok FROM allowed)
        UNION ALL SELECT bucket,dept,amt FROM credits WHERE (SELECT ok FROM allowed)) t
  GROUP BY t.bucket, t.dept
  ORDER BY t.bucket, t.dept
$function$;


-- ── 3. scoreboard_techs_revenue (many technicians) ──────────────────────────────
create or replace function public.scoreboard_techs_revenue(p_company_id uuid, p_start date, p_end date, p_bucket text, p_tech_external_ids text[])
 returns table(tech_external_id text, bucket date, dept text, total numeric)
 language sql security definer set search_path to 'public', 'pg_temp'
as $function$
  WITH allowed AS (
    SELECT ((SELECT auth.uid()) IS NULL OR EXISTS (
      SELECT 1 FROM user_profiles up WHERE up.id=(SELECT auth.uid())
        AND up.company_id=p_company_id AND (up.role='admin' OR up.can_access_scoreboards))) AS ok
  ),
  recurring AS (
    SELECT tech.tid AS tech_external_id,
           date_trunc(CASE WHEN p_bucket='week' THEN 'week' ELSE 'month' END, v.completed_at)::date AS bucket,
           COALESCE(li.dept_prefix, j.dept_prefix, 'Other') AS dept, li.total AS amt
    FROM unnest(p_tech_external_ids) AS tech(tid)
    JOIN visits v ON tech.tid = ANY(v.tech_external_user_ids)
      AND v.company_id=p_company_id AND v.deleted_at IS NULL AND v.visit_status='COMPLETED'
      AND v.completed_at::date BETWEEN p_start AND p_end AND UPPER(COALESCE(v.title,'')) NOT LIKE '%BILLING%'
    JOIN jobs j ON j.id=v.job_id AND j.deleted_at IS NULL AND j.is_recurring=true
    JOIN line_items li ON li.parent_external_id=v.external_id AND li.parent_type='visit'
      AND li.company_id=p_company_id AND li.deleted_at IS NULL
  ),
  oneoff AS (
    SELECT tech.tid AS tech_external_id,
           date_trunc(CASE WHEN p_bucket='week' THEN 'week' ELSE 'month' END, v.completed_at)::date AS bucket,
           COALESCE(j.dept_prefix, substring(UPPER(COALESCE(j.title,'')) from '^(WF|IR|PW|MO|LD)'), 'Other') AS dept,
           j.total / NULLIF(jc.n,0) AS amt
    FROM unnest(p_tech_external_ids) AS tech(tid)
    JOIN visits v ON tech.tid = ANY(v.tech_external_user_ids)
      AND v.company_id=p_company_id AND v.deleted_at IS NULL AND v.visit_status='COMPLETED'
      AND v.completed_at::date BETWEEN p_start AND p_end AND UPPER(COALESCE(v.title,'')) NOT LIKE '%BILLING%'
    JOIN jobs j ON j.id=v.job_id AND j.deleted_at IS NULL AND j.is_recurring=false
    JOIN LATERAL (SELECT count(*) n FROM visits v2 WHERE v2.job_id=j.id AND v2.deleted_at IS NULL AND v2.visit_status='COMPLETED') jc ON true
    WHERE NOT EXISTS (SELECT 1 FROM install_labor_credits c WHERE c.company_id=p_company_id AND c.job_id=j.id)
  ),
  credits AS (
    SELECT c.jobber_user_external_id AS tech_external_id,
           date_trunc(CASE WHEN p_bucket='week' THEN 'week' ELSE 'month' END, c.credit_date)::date AS bucket,
           COALESCE(j.dept_prefix, substring(UPPER(COALESCE(j.title,'')) from '^(WF|IR|PW|MO|LD)'), 'Other') AS dept,
           c.credit_amount AS amt
    FROM install_labor_credits c JOIN jobs j ON j.id=c.job_id
    WHERE c.company_id=p_company_id AND c.credit_date BETWEEN p_start AND p_end
      AND c.jobber_user_external_id = ANY(p_tech_external_ids)
  )
  SELECT t.tech_external_id, t.bucket, t.dept, SUM(t.amt) AS total
  FROM (SELECT tech_external_id,bucket,dept,amt FROM recurring WHERE (SELECT ok FROM allowed)
        UNION ALL SELECT tech_external_id,bucket,dept,amt FROM oneoff WHERE (SELECT ok FROM allowed)
        UNION ALL SELECT tech_external_id,bucket,dept,amt FROM credits WHERE (SELECT ok FROM allowed)) t
  GROUP BY t.tech_external_id, t.bucket, t.dept
  ORDER BY t.tech_external_id, t.bucket, t.dept
$function$;


-- ── 4. scoreboard_visit_revenue_trend (techs + line_techs) ──────────────────────
-- ⚠ ONLY tech_parts changes. periods / lines / total read `parts`, which is identical
-- to before apart from an added job_id column that nothing else selects. That is the
-- regression test: total, periods and lines must hash the same before and after.
create or replace function public.scoreboard_visit_revenue_trend(p_company_id uuid, p_start date, p_end date, p_grain text DEFAULT 'month'::text, p_tech_credit text DEFAULT 'each'::text)
 returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
with allowed as (select public.scoreboard_reports_allowed(p_company_id) ok),
g as (
  select case when lower(coalesce(p_grain, 'month')) = 'week' then 'week' else 'month' end gr,
         case when lower(coalesce(p_tech_credit, 'each')) = 'split' then 'split' else 'each' end credit
),
vis as (
  select v.id, v.external_id, v.job_id, v.tech_external_user_ids techs,
         date_trunc((select gr from g), (v.completed_at at time zone 'America/Chicago')::date)::date b,
         j.dept_prefix jdept, j.title jtitle, j.is_recurring, j.total jtotal
  from visits v
  join jobs j on j.id = v.job_id and j.deleted_at is null
  where (select ok from allowed)
    and v.company_id = p_company_id and v.deleted_at is null
    and v.visit_status = 'COMPLETED'
    and (v.completed_at at time zone 'America/Chicago')::date between p_start and p_end
    and upper(coalesce(v.title, '')) not like '%BILLING%'
),
rec as (
  select vis.id vid, vis.b, coalesce(li.dept_prefix, vis.jdept, 'Other') dept,
         li.total amt, vis.techs, vis.job_id
  from vis
  join line_items li on li.parent_external_id = vis.external_id and li.parent_type = 'visit'
   and li.company_id = p_company_id and li.deleted_at is null
  where vis.is_recurring
),
oneoff as (
  select vis.id vid, vis.b,
         coalesce(vis.jdept, substring(upper(coalesce(vis.jtitle, '')) from '^(WF|IR|PW|MO|LD)'), 'Other') dept,
         vis.jtotal / nullif(jc.n, 0) amt, vis.techs, vis.job_id
  from vis
  join lateral (
    select count(*) n from visits v2
    where v2.job_id = vis.job_id and v2.deleted_at is null and v2.visit_status = 'COMPLETED'
  ) jc on true
  where not vis.is_recurring
),
parts as (select * from rec union all select * from oneoff),
credited_jobs as (select distinct job_id from install_labor_credits where company_id = p_company_id),
periods as (select b, sum(amt) total, count(distinct vid) visits from parts group by b),
lines as (select b, dept, sum(amt) total from parts group by b, dept),
tech_parts as (
  select p.b, p.dept, t.tid,
         case when (select credit from g) = 'split'
              then p.amt / nullif(array_length(p.techs, 1), 0)
              else p.amt end amt
  from parts p
  cross join lateral unnest(coalesce(p.techs, array[]::text[])) as t(tid)
  where not exists (select 1 from credited_jobs cj where cj.job_id = p.job_id)
  union all
  -- ⚠ used as-is under BOTH credit modes: a credit row is already one person's share.
  select date_trunc((select gr from g), c.credit_date)::date b,
         coalesce(j.dept_prefix, substring(upper(coalesce(j.title, '')) from '^(WF|IR|PW|MO|LD)'), 'Other') dept,
         c.jobber_user_external_id tid, c.credit_amount amt
  from install_labor_credits c join jobs j on j.id = c.job_id
  where c.company_id = p_company_id and c.credit_date between p_start and p_end
    and c.jobber_user_external_id is not null
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
  select p.b, p.dept, null::text tid, 'Nobody assigned' name, sum(p.amt) total
  from parts p
  where coalesce(array_length(p.techs, 1), 0) = 0
    and not exists (select 1 from credited_jobs cj where cj.job_id = p.job_id)
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
  'unattributed_visits',  (select unattributed_visits from gaps),
  'install_credits_applied', (select count(*) from install_labor_credits c
                              where c.company_id = p_company_id and c.credit_date between p_start and p_end)
)
where (select ok from allowed)
$function$;

revoke all on function public.scoreboard_visit_revenue_trend(uuid, date, date, text, text) from public, anon;
grant execute on function public.scoreboard_visit_revenue_trend(uuid, date, date, text, text) to authenticated, service_role;
