-- Crew & Labor: report clocked hours on the TIMECLOCK's own window, not payroll's.
--
-- WHY. `scoreboard_crew_labor` clamps its window to least(last clocked day, last
-- processed payroll) because every RATE it computes divides revenue by hours, and
-- half a ratio is a lie. That clamp is right for the rates and wrong for "Hours
-- Clocked", which is a plain additive total that needs no payroll at all: the crew
-- worked those hours whether or not the wages have been imported yet. On 2026-09-14
-- the payroll import had been dead since Aug 16 while the timeclock was current to
-- Sep 11, and Hours Clocked showed nothing for September — hours that were sitting
-- right there in `time_entries`.
--
-- WHAT CHANGES. Purely ADDITIVE: three new coverage keys, one new top-level total,
-- one new per-person field. Every existing key keeps its exact current meaning and
-- value, so the Crew & Labor report and every other widget are untouched.
--     coverage.clock_start / clock_end / clock_has_data  -- the timeclock-only window
--     clock_hours                                        -- total, unclamped by payroll
--     people[].clock_hours                               -- same, per person
--
-- ⚠ KNOWN LIMIT, deliberately left alone. `people_raw` membership is unchanged, so
-- someone whose ONLY hours fall in the unpaid tail (a new hire who started after the
-- last payroll run) still does not appear at all — exactly as today. Adding them
-- would change who shows up in the ranking, the table and by-department for every
-- caller, which is a much wider change than this one. The consequence is that
-- `clock_hours` is the sum over the SAME people as `hours`, so the two totals always
-- describe the same roster and can never disagree about who is in them.

create or replace function public.scoreboard_crew_labor(
  p_company_id uuid, p_start date, p_end date
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
  -- ⚠ The timeclock's OWN window, free of the payroll edge. `greatest`/`least` ignore
  -- nulls in Postgres, so a company with no timeclock at all would otherwise get the
  -- full requested range here and silently report 0 hours as though it had measured
  -- them; `ok` carries the "there is a timeclock" test explicitly instead.
  clock_eff as (
    select greatest(p_start, b.tc_first) s, least(p_end, b.tc_last) e,
           (b.tc_first is not null
            and greatest(p_start, b.tc_first) <= least(p_end, b.tc_last)) ok
    from bounds b
  ),
  tc_hours as (
    select te.employee_id, sum(te.total_hours) hours
    from time_entries te, eff
    where te.company_id = p_company_id and te.total_hours > 0
      and te.date between greatest(eff.s, coalesce(eff.tc_first, eff.s)) and eff.e
    group by 1
  ),
  -- Hours over the timeclock window rather than the payroll-clamped one. Same rows,
  -- same definition of an hour — only the right-hand edge differs.
  tc_hours_full as (
    select te.employee_id, sum(te.total_hours) hours
    from time_entries te, clock_eff ce
    where te.company_id = p_company_id and te.total_hours > 0
      and ce.ok and te.date between ce.s and ce.e
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
      coalesce(tf.hours, 0) as clock_hours,
      round(coalesce(c.cost, 0), 2) as labor_cost,
      round(coalesce(c.commission, 0), 2) as commission,
      (select ju.external_id from jobber_users ju
        where ju.company_id = e.company_id and ju.name ilike '%' || e.last_name || '%'
          and (ju.name ilike '%' || e.first_name || '%'
               or (nullif(e.preferred_name,'') is not null and ju.name ilike '%' || e.preferred_name || '%'))
        order by ju.is_active desc nulls last, ju.external_id limit 1) as jobber_id
    from employees e
    left join tc_hours t on t.employee_id = e.id
    left join tc_hours_full tf on tf.employee_id = e.id
    left join pr_hours_pre hp on hp.employee_id = e.id
    left join pr_cost c on c.employee_id = e.id
    where e.company_id = p_company_id and e.is_field_labor
      -- ⚠ UNCHANGED on purpose — `tf` is deliberately NOT in this list. See the note
      -- at the top: widening it would change who appears in every other Crew card.
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
    -- credit_date, not on_site_date: a credit must land in the same window as the
    -- revenue it came out of (job #1133 was worked Dec 2025, recognised 2026-01-02).
    select c.jobber_user_external_id, c.credit_amount
    from install_labor_credits c, eff
    where c.company_id = p_company_id
      and c.credit_date between eff.s and eff.e
      and c.jobber_user_external_id is not null
  ),
  tech_rev as (select tid, sum(amt) amt from tech_rev_parts group by tid),
  totals as (
    select (select round(sum(hours),1) from people) hours,
           (select round(sum(clock_hours),1) from people) clock_hours,
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
      -- The timeclock-only window. NULL start/end whenever there is nothing to show,
      -- so a caller cannot print a range that was never measured.
      'clock_has_data', (select ok from clock_eff),
      'clock_start', (select case when ok then s end from clock_eff),
      'clock_end', (select case when ok then e end from clock_eff),
      'install_credits_applied', (select count(*) from install_labor_credits c, eff
                                  where c.company_id = p_company_id and c.credit_date between eff.s and eff.e)
    ),
    'hours', coalesce((select hours from totals), 0),
    -- Clocked hours over the timeclock's own window. Equals `hours` whenever payroll
    -- is current; larger whenever it is behind. Never used as a rate denominator.
    'clock_hours', coalesce((select clock_hours from totals), 0),
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
          'clock_hours', round(pe.clock_hours, 1),
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
$$;
