-- Field-labour flag on employees. APPLIED 2026-08-12 to the shared DB.
--
-- Crew & Labor and Service Line Profitability divide revenue by FIELD labour. The
-- filter used to be `pay_type = 'hourly'`, which is not the same question and let
-- the Office Manager into the denominator: she is salaried today, but the Gusto
-- payroll backfill reaches back to weeks when she was NONEXEMPT, and the backfill
-- half admits anyone whose `flsa_status <> 'Exempt'`. That put 281 hours and
-- $4,636.82 of office wages against field revenue, reading $83.34/labour-hour when
-- the real figure is $88.19.
--
-- Why a flag and not a department rule: department strings are per-subscriber
-- ("06 - Office Admin" means nothing in another tenant's Gusto), and they drift —
-- one technician sits in "01 - Fert Tech" with the job title "Lead Technician - IR".
-- A subscriber needs to be able to SAY who is field labour. This is the first piece
-- of the per-tenant configuration layer the reports need (REPORTS_PRD §7).
--
-- DEFAULTS TRUE on purpose: a new hire counts until someone says otherwise.
-- Silently dropping a person understates cost, which is the direction of error that
-- makes you underprice — the same reasoning as the unassigned-hours bucket.

alter table employees add column if not exists is_field_labor boolean not null default true;

comment on column employees.is_field_labor is
 'Does this person''s time count as FIELD labour in the Crew & Labor and Service Line reports? Office and management staff are excluded so they cannot dilute $/labour-hour. Defaults true: a new hire counts until told otherwise, because silently dropping someone understates cost. Needed because pay_type alone is not enough — a salaried office manager can have earlier NONEXEMPT payroll weeks that would otherwise be admitted by the backfill.';

-- Heroes: the two non-field staff. Everyone else keeps the default.
--   update employees set is_field_labor = false
--    where company_id = '00000000-0000-0000-0000-000000000002'
--      and job_title in ('Office Manager', 'General Manager');

-- Both reporting functions were then narrowed to honour the flag. Applied as a
-- surgical replace against pg_get_functiondef (anchor asserted present and unique
-- first, so a schema drift raises instead of silently patching nothing) rather than
-- retyping 8KB of SQL:
--
--   scoreboard_crew_labor      people_raw:  where e.company_id = p_company_id
--                                        -> where e.company_id = p_company_id and e.is_field_labor
--   scoreboard_service_lines   tech:        from employees e where e.company_id = p_company_id
--                                        -> ... and e.is_field_labor
--
-- ⚠ CREATE OR REPLACE re-grants EXECUTE to PUBLIC by Supabase default (the July
-- anon-leak trap). Both were re-revoked and verified: anon=false, authenticated=true.
--
--   revoke execute on function public.scoreboard_crew_labor(uuid,date,date)    from public, anon;
--   grant  execute on function public.scoreboard_crew_labor(uuid,date,date)    to authenticated, service_role;
--   revoke execute on function public.scoreboard_service_lines(uuid,date,date) from public, anon;
--   grant  execute on function public.scoreboard_service_lines(uuid,date,date) to authenticated, service_role;
--
-- Verified on Heroes, Jan 1 – Aug 11 2026:
--   hours     5,104.2 -> 4,823.2      (-281.0, exactly the excluded weeks)
--   wages   $95,916.74 -> $91,279.92  (-$4,636.82, likewise)
--   revenue $425,372.83 unchanged     (excluding office staff must not move revenue)
--   $/hour      $83.34 -> $88.19  ·  labour 22.5% -> 21.5%
--
-- ⚠ STILL OPEN, unrelated to this change: the live timeclock costing ignores
-- OVERTIME (the backfill found 165.5 OT hours at 1.5x) and prices old weeks at
-- today's rate, so backfilled months are currently more accurate than June onward.
--
-- ⚠ NOT YET EXPOSED IN THE UI. Until the Employee Roster gets a toggle, this flag
-- can only be set in SQL — fine for Heroes, not fine for a subscriber.
