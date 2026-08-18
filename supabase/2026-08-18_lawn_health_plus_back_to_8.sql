-- Lawn Health Plus: 12 -> 8 rounds a year. Correcting yesterday's change.
--
-- 2026-08-17 set this to 12 because Jobber's own "WF Recurring Jobs" export
-- annualised all 11 Plus jobs at total x 12, and taking 12 made the scoreboard match
-- that export to the cent. It was FLAGGED at the time rather than trusted, because
-- Jobber contradicted itself: Basic and Plus carry identical settings (visit
-- "Every 46 days", billing "After every visit") yet Jobber annualised Basic x8 and
-- Plus x12, while 365/46 = 7.9 argues 8 for both.
--
-- Ben settled it 2026-08-18: "lawn health plus is 8. if my export said that - it was
-- wrong and I applied the wrong formula. basic and plus are 8. complete and RRR are 12."
--
-- ⚠ So the export was the unreliable source, not the scoreboard. WF now reads
-- $282,728.40 across 167 jobs — the JOB COUNT still matches the export exactly, and
-- the $7,320.84 difference in value is entirely those 11 Plus jobs, which the export
-- multiplied by 12 instead of 8. Do not "fix" that gap by matching the export again.
--
-- Durable point: an owner's own exported report is evidence, not ground truth. It can
-- carry a hand-applied formula. Reconciling to it job-for-job was still the right
-- move — that is what isolated the discrepancy to one program instead of leaving a
-- vague $47k gap — but where the two disagreed, the owner decided, not the file.
--
-- ROLLBACK: set visits_per_year = 12 for the same row.

begin;

update public.recurring_program_definitions
set visits_per_year = 8
where company_id = '00000000-0000-0000-0000-000000000002'
  and line_item_name = 'WF - Lawn Health Plus';

commit;

-- Heroes' WF cadences after this, per Ben:
--   Lawn Health Basic     8/yr
--   Lawn Health Plus      8/yr
--   Lawn Health Complete 12/yr
--   Lawn Health Monthly  12/yr
--   Root Rot Recovery    12/yr
