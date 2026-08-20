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
-- COST comes from payroll_periods.wages_cost across the whole window. HOURS stay
-- with the timeclock, which was never the broken part: the two sources agree to the
-- hundredth where they overlap (week of Jun 15-21, five people, verified 2026-08-12),
-- and revenue-per-hour barely moved across this change ($92.23 -> $91.84, the
-- difference being a 3-day-shorter window). Only cost was wrong.
--
-- ⚠⚠ A BUG THIS CAUGHT DURING ROLLOUT, worth remembering. The first version took
-- hours as `coalesce(timeclock_hours, payroll_hours, 0)`. That looks like a sensible
-- preference order and is badly wrong: the timeclock starts 2026-06-01 while payroll
-- reaches back to 2025-12-22, so for anyone with ANY timeclock row the coalesce
-- returned June-onward hours only — while cost still spanned January onward. A
-- denominator carrying less than its numerator. Year-to-date read 1,859.1 hours and
-- $246.05 per labour hour against a true 4,980.7 and $91.84 — a 2.7x overstatement
-- on the flagship metric, i.e. the exact failure the original file was written to
-- prevent, reintroduced by a one-word change. HOURS ARE THEREFORE STITCHED AND
-- ADDED (timeclock from tc_first on, PLUS payroll before it), never chosen between.
-- The tell was that rev_per_hour moved at all: if hours are right, it cannot.
--
-- CONSEQUENCE, and Ben's explicit choice (2026-08-20): the window now ENDS AT THE
-- LAST PROCESSED PAYROLL. Work done after it has hours but no dollars, and pricing
-- those days from a rate cannot see a commission at all, so the newest days would
-- drag the ratio down. Better a slightly older window that is entirely real money.
-- This also fixed a live overstatement: Josh Allen and Wilson Leon read HIGHER than
-- they had ever been paid, because Aug 10-19 was priced at rate.
--
-- ⚠ Partial weeks at either edge are pro-rated by days of overlap — weekly payroll
-- cannot say which day an hour fell on.
--
-- VERIFIED against Ben's Gusto export, Mike Cyplik, to the penny:
--   Gusto regular+OT+commission, work weeks Dec 22 - Aug 9      32,366.34
--     - work week Dec 22-28 (outside the Jan 1 start)              -285.27
--     - the December 3/7 of the Dec 29 - Jan 4 week                -443.91
--     + the Aug 10-16 week, now inside the window                  +994.30
--   = 32,631.46, exactly what the card reports. Commission alone: 6,078.01 vs
--   Gusto's 6,272.33 less 3/7 of that Dec week (194.32) = 6,078.01.
-- Company year-to-date: labour 97,133.67 -> 106,856.39 · 20.7% -> 23.4% ·
-- rev/labour-hour 92.23 -> 91.84 · hours 5,075.9 -> 4,980.7 (window ends Aug 16).
--
-- The canonical body as applied lives in the migration history
-- (crew_labor_payroll_cost_with_commission_2026_08_20), same convention as the
-- 2026-08-12 overtime change. Its key clauses, so a reader can follow the logic
-- without leaving this file:
--
--   tc          = min/max time_entries.date for HOURLY FIELD LABOUR only (a stray
--                 salaried test punch once pinned this 3 days early)
--   pay         = min/max payroll_periods.period for non-Exempt weeks
--   data_last   = least(tc.last_day, pay.pay_last)   <-- never past a real payroll
--   tc_hours       = time_entries between greatest(eff.s, tc_first) and eff.e
--   pr_hours_pre   = payroll hours, pro-rated, for eff.s .. tc_first - 1
--   hours          = coalesce(tc_hours,0) + coalesce(pr_hours_pre,0)   <-- ADDED
--   pr_cost        = payroll wages_cost + commission, pro-rated, across eff.s .. eff.e
--   labor_cost     = pr_cost.cost
--
-- coverage adds: payroll_through (the hard right edge) and unpaid_tail_days (clocked
-- days after it, excluded rather than estimated — 3 as of 2026-08-20).

revoke all on function public.scoreboard_crew_labor(uuid, date, date) from public, anon;
grant execute on function public.scoreboard_crew_labor(uuid, date, date) to authenticated, service_role;

create index if not exists idx_payroll_periods_company_emp_period
  on payroll_periods (company_id, employee_id, period_start, period_end);

-- ⚠ Supabase re-grants EXECUTE to PUBLIC on every CREATE OR REPLACE. Verified after
-- applying: anon = false, authenticated = true.
