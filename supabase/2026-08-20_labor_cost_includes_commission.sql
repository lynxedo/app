-- Labor cost becomes REAL MONEY: regular + overtime + commission, taken from
-- Gusto payroll for every week instead of derived from hours x rate.
--
-- WHY (found 2026-08-20, from Ben's Gusto YTD export):
-- The Crew & Labor cards said Mike Cyplik earned $27,056 "in wages". Gusto paid him
-- $34,908.80. Nothing was miscounted — `labor_cost` only ever meant REGULAR + OVERTIME,
-- and the cards called it "wages" while caveating the wrong omission ("salaried staff
-- not included"). Commission, holiday, PTO, bonus and tips were all silently absent.
--
-- Reconciled to the penny before changing anything:
--     Gusto gross YTD                                     34,908.80
--       - commission 6,272.33 · tips/holiday 1,316.46
--         · PTO 896.00 · bonus 330.00
--     = regular + overtime                                26,094.01
--       - work week Dec 22-28 (before the Jan 1 window)      -285.27
--       - the December 3/7 of the Dec 29-Jan 4 week          -249.59
--       + Aug 10-19 hours counted but not yet paid          1,560.20
--       - OT premium understated (bonus not blended in)       -63.28
--     = 27,056.07  vs the card's 27,056.06                        ✓
--
-- Ben's rule: count REGULAR + OVERTIME + COMMISSION. Holiday, vacation/sick, bonus
-- and tips stay out. Effect on Heroes YTD: labor cost 97,133.67 -> ~108,975,
-- Labor Cost % of Revenue 20.7% -> 23.3%.
--
-- ⚠ A CLASSIFICATION TRAP worth remembering: Gusto's CSV "Paid time off earnings"
-- column counts Vacation and Sick but NOT Holiday, so 8-hours-x-rate holiday pay
-- lands in no named column and looks like "tips". It is identifiable only from the
-- payroll record's paid_time_off[] array (Angel 8h = $164.00 = 8 x 20.50). Holiday
-- is therefore imported as its OWN column, never folded into an "other" bucket.
--
-- ⚠ ONE KNOWN GAP, DELIBERATELY NOT GUESSED AT: in the 2026-03-09 payroll Gusto's
-- Commission line reads $0.00 for every employee and the money was entered as
-- "Paycheck Tips" instead (Mike 542.46, Angel 613.88, Lucas 76.32, Bonnie 2.20).
-- That is almost certainly misposted commission — $1,234.86 of field labour. No
-- heuristic reclassifies it here: a rule that decides which tip rows are "really"
-- commission produces a number nobody can defend later. Fix the three lines in
-- Gusto and the sync picks them up. Until then those dollars are excluded.
--
-- ⚠ SCOPE: scoreboard_service_lines has the SAME flat-rate defect and is NOT touched.
-- Its labour splits across service lines per tech-day, so adding a weekly commission
-- needs its own attribution decision. Separate increment.

-- ── 1. Full earnings breakdown per employee-payroll ─────────────────────────
-- Additive only. Existing `labor_cost` is LEFT ALONE so nothing that reads it
-- changes meaning underneath; the new `wages_cost` is what the report now uses.
-- Keyed by (company_id, source, external_id, employee_external_id) which is the
-- PAYROLL uuid, so an off-cycle run sharing a week with the regular run gets its
-- own row instead of colliding with it.

alter table payroll_periods
  add column if not exists regular_earnings   numeric,
  add column if not exists overtime_earnings  numeric,
  add column if not exists commission         numeric,
  add column if not exists bonus              numeric,
  add column if not exists holiday_earnings   numeric,
  add column if not exists pto_earnings       numeric,
  add column if not exists tips               numeric,
  add column if not exists other_earnings     numeric,
  add column if not exists gross_pay          numeric,
  -- What the Crew & Labor report spends: regular + overtime + commission.
  -- Generated, so it can never drift from its parts.
  add column if not exists wages_cost numeric
    generated always as (
      coalesce(regular_earnings,0) + coalesce(overtime_earnings,0) + coalesce(commission,0)
    ) stored,
  add column if not exists off_cycle boolean default false,
  add column if not exists check_date date;

comment on column payroll_periods.wages_cost is
  'Regular + overtime + commission — the figure Crew & Labor reports as labour cost (Ben, 2026-08-20). Excludes holiday, vacation/sick, bonus, tips and reimbursements.';
comment on column payroll_periods.holiday_earnings is
  'Holiday pay. Kept separate because Gusto''s CSV "Paid time off earnings" column EXCLUDES holiday, so folding it anywhere else makes it look like tips.';
comment on column payroll_periods.labor_cost is
  'LEGACY: regular + overtime only, as hand-imported 2026-08-12. Superseded by wages_cost. Kept so older analyses stay reproducible.';


-- ── 2. scoreboard_crew_labor: dollars from payroll, hours from the timeclock ──
--
-- The shape changes from "payroll before the timeclock era, hours x rate after" to
-- "payroll for cost ALWAYS, timeclock for hours ALWAYS". They are no longer two
-- halves stitched at a boundary — they are two different measurements of the same
-- weeks, each taken from the source that actually knows it:
--
--   HOURS  <- time_entries. What rev_per_hour divides by. Unchanged, and it was
--             never the broken part: the two sources agree to the hundredth where
--             they overlap (week of Jun 15-21, five people, verified 2026-08-12).
--   COST   <- payroll_periods.wages_cost (regular + overtime + commission).
--
-- CONSEQUENCE, and Ben's explicit choice (2026-08-20): the window now ENDS AT THE
-- LAST PROCESSED PAYROLL. Work done after it has hours but no dollars, and pricing
-- those days from hours would reintroduce exactly the estimate this replaces —
-- worse, it cannot estimate a commission at all, so the newest days would drag the
-- ratio down. Better to report a slightly older window that is entirely real money.
-- This also fixes a live overstatement: Josh Allen and Wilson Leon read HIGHER than
-- they had ever been paid, because the report counted Aug 10-19 at rate.
--
-- ⚠ Partial weeks at either edge are still pro-rated by days of overlap — weekly
-- payroll cannot say which day an hour fell on. Applied to BOTH hours and cost from
-- the same fraction, so a clamped window can never carry cost without its hours.

create or replace function public.scoreboard_crew_labor(
  p_company_id uuid,
  p_start date,
  p_end date
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with allowed as (select public.scoreboard_reports_allowed(p_company_id) ok),
  -- Timeclock coverage, restricted to hourly field staff so a stray salaried test
  -- punch cannot set the boundary (that bug cost 3 days of wages in Aug 2026).
  tc as (
    select min(te.date) first_day, max(te.date) last_day
    from time_entries te
    join employees e on e.id = te.employee_id
    where te.company_id = p_company_id and te.total_hours > 0
      and e.is_field_labor and e.pay_type = 'hourly'
  ),
  -- Payroll coverage. `pay_last` is the hard right edge of the whole report: past
  -- it there is no money, only hours.
  pay as (
    select min(period_start) pay_first, max(period_end) pay_last
    from payroll_periods
    where company_id = p_company_id and coalesce(flsa_status,'') <> 'Exempt'
  ),
  bounds as (
    select
      least(coalesce(tc.first_day, pay.pay_first), coalesce(pay.pay_first, tc.first_day)) data_first,
      -- ⚠ Never past the last processed payroll, even if the timeclock runs later.
      least(coalesce(tc.last_day, pay.pay_last), coalesce(pay.pay_last, tc.last_day)) data_last,
      pay.pay_last, tc.last_day tc_last
    from tc, pay
  ),
  eff as (
    select greatest(p_start, b.data_first) s, least(p_end, b.data_last) e,
           b.data_first, b.data_last, b.pay_last, b.tc_last
    from bounds b
  ),
  -- Hours from the timeclock, inside the effective window.
  tc_hours as (
    select te.employee_id, sum(te.total_hours) hours
    from time_entries te, eff
    where te.company_id = p_company_id and te.total_hours > 0
      and te.date between eff.s and eff.e
    group by 1
  ),
  -- Cost from payroll, pro-rated where a pay week straddles the window edge.
  -- ⚠ Off-cycle runs share a pay period with their regular run and are separate
  -- rows, so this sums rather than picking one.
  pr as (
    select pp.employee_id,
           sum(pp.wages_cost * f.frac) cost,
           sum(coalesce(pp.commission,0) * f.frac) commission,
           sum((pp.regular_hours + pp.overtime_hours) * f.frac) paid_hours
    from payroll_periods pp, eff
    cross join lateral (
      select greatest(0, (least(pp.period_end, eff.e) - greatest(pp.period_start, eff.s) + 1))::numeric
             / nullif(pp.period_end - pp.period_start + 1, 0) as frac
    ) f
    where pp.company_id = p_company_id
      and coalesce(pp.flsa_status,'') <> 'Exempt'
      and pp.period_start <= eff.e and pp.period_end >= eff.s
      and f.frac > 0
    group by pp.employee_id
  ),
  people_raw as (
    select e.id,
      coalesce(nullif(e.preferred_name,''), e.first_name) || ' ' || e.last_name as name,
      coalesce(nullif(e.department,''), 'Unassigned') as department,
      e.pay_type, e.hourly_rate, e.is_active,
      -- Hours prefer the timeclock; payroll hours stand in only where the
      -- timeclock never ran, so the denominator is never empty for a paid week.
      coalesce(t.hours, p.paid_hours, 0) as hours,
      round(coalesce(p.cost, 0), 2) as labor_cost,
      round(coalesce(p.commission, 0), 2) as commission,
      (select ju.external_id from jobber_users ju
        where ju.company_id = e.company_id and ju.name ilike '%' || e.last_name || '%'
          and (ju.name ilike '%' || e.first_name || '%'
               or (nullif(e.preferred_name,'') is not null and ju.name ilike '%' || e.preferred_name || '%'))
        order by ju.is_active desc nulls last, ju.external_id limit 1) as jobber_id
    from employees e
    left join tc_hours t on t.employee_id = e.id
    left join pr p on p.employee_id = e.id
    where e.company_id = p_company_id and e.is_field_labor
      and (t.employee_id is not null or p.employee_id is not null)
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
  tech_rev as (
    select t.tid, sum(vr.amt) amt
    from (select distinct jobber_id tid from people where jobber_id is not null) t
    join vis v on t.tid = any(v.tech_external_user_ids)
    join visit_rev vr on vr.visit_id = v.id group by t.tid
  ),
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
      -- Now always true: cost is payroll everywhere, not just before a boundary.
      'backfilled', true,
      'backfill_until', null,
      'payroll_through', (select pay_last from eff),
      -- Days with clocked hours that no payroll has paid yet, so the reader knows
      -- why the window stops short of today.
      'unpaid_tail_days', (select greatest(0, tc_last - pay_last) from eff)
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
$$;

comment on function public.scoreboard_crew_labor(uuid, date, date) is
  'Crew & Labor 8.6. HOURS from the timeclock, COST from Gusto payroll as regular + overtime + commission (wages_cost). Window ends at the last processed payroll so every dollar is real money — see unpaid_tail_days. Excludes holiday, vacation/sick, bonus, tips.';

-- ⚠ Supabase re-grants EXECUTE to PUBLIC on CREATE OR REPLACE. Re-revoke.
revoke all on function public.scoreboard_crew_labor(uuid, date, date) from public, anon;
grant execute on function public.scoreboard_crew_labor(uuid, date, date) to authenticated, service_role;

create index if not exists idx_payroll_periods_company_emp_period
  on payroll_periods (company_id, employee_id, period_start, period_end);
