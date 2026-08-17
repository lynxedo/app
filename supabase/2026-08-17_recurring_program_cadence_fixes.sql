-- Recurring program definitions: cadence corrections + two missing rows.
--
-- Reconciled against Ben's Jobber "WF Jobs - Recurring Jobs" export of 2026-08-17
-- (167 jobs, $290,049.24 annual). Every dollar of the $47,040.36 gap against the
-- scoreboard's $243,008.88 was accounted for; this file fixes the four causes that
-- live in DATA. The fifth and largest — line items falsely tombstoned by the sync's
-- reconcile — is a code fix in lib/jobber-sync.ts plus a re-sync, not a migration.
--
-- ⚠ Cadence CANNOT be derived from our own data and must stay declared. Two
-- measurements proved it: (1) Jobber pre-populates line items on FUTURE visits, so
-- counting "visits that carry a charge" forward returns every visit and tells you
-- nothing about billing; (2) no WF job in the book has a completed visit older than
-- 365 days — the visit mirror starts at the Jan 2026 backfill floor — so a full
-- trailing year of real charges does not exist to count. Jobber's own Annual Value
-- column is therefore the authority here.

-- ROLLBACK (recorded inline rather than in a snapshot table — it is two values, and
-- a snapshot table would need RLS enabling and anon revoking to not be a leak):
--   update public.recurring_program_definitions set visits_per_year = 8
--     where company_id = '00000000-0000-0000-0000-000000000002'
--       and line_item_name = 'WF - Lawn Health Plus';
--   update public.recurring_program_definitions set visits_per_year = 104
--     where company_id = '00000000-0000-0000-0000-000000000002'
--       and line_item_name = 'PW - Pet Waste Removal 2x Week';
--   delete from public.recurring_program_definitions
--     where company_id = '00000000-0000-0000-0000-000000000002'
--       and line_item_name in ('WF - Artificial Turf Weed Control',
--                              'WF - Specialty Weed Control');

begin;

-- 1) Lawn Health Plus: 8 -> 12 rounds a year.
--
-- ⚠ FLAGGED FOR BEN, because Jobber contradicts itself here and he is the one who
-- knows: Basic and Plus carry IDENTICAL Jobber settings (visit "Every 46 days",
-- billing "After every visit"), yet Jobber annualises Basic at x8 and Plus at x12
-- on all 11 of its jobs. A 46-day cadence is 365/46 = 7.9 visits, which argues 8;
-- Jobber's own annual figure argues 12. Taking 12 makes the book agree with the
-- export to the cent. If a Plus customer is really charged 8 times a year, set this
-- back to 8 — it is 6 jobs and $3,390.40.
update public.recurring_program_definitions
set visits_per_year = 12
where company_id = '00000000-0000-0000-0000-000000000002'
  and line_item_name = 'WF - Lawn Health Plus';

-- 2) PW 2x Week: 104 -> 52 charges a year. This one LOWERS the book.
--
-- Confirmed by Ben 2026-08-17: a twice-weekly customer has TWO jobs, each visited
-- and invoiced weekly. So the "2x" lives in the job COUNT, not in one job's cadence
-- — 104 counted each job twice. Thomas White holds job 4 (PW 2x1 $24) and job 1926
-- (PW 2x2 $24) and pays $48/week; the book was reporting $4,992/yr for a customer
-- who pays $2,496. Measured independently: $28.12 per visit x 13 completed visits
-- in 90 days annualises to $1,462.24, exactly half the $2,924.48 the book showed.
update public.recurring_program_definitions
set visits_per_year = 52
where company_id = '00000000-0000-0000-0000-000000000002'
  and line_item_name = 'PW - Pet Waste Removal 2x Week';

-- 3) WF - Artificial Turf Weed Control: a base program with no definition row, so
-- its only job (#2033, Michael Heritage, Klein) never reached the book at all.
-- Jobber: visit frequency "Every 4 weeks", annual = total x 12 — the two agree, so
-- 12 is safe here.
insert into public.recurring_program_definitions
  (company_id, line_item_name, dept_prefix, is_recurring, program_group,
   visits_per_year, is_auxiliary, display_name)
values
  ('00000000-0000-0000-0000-000000000002', 'WF - Artificial Turf Weed Control',
   'WF', true, null, 12, false, 'Artificial Turf Weed Control')
on conflict (company_id, line_item_name) do nothing;

-- 4) WF - Specialty Weed Control: an ADD-ON, not a program. visits_per_year stays
-- null so it inherits the cadence of whatever base program shares its job — which
-- is how add-ons already work (Plant Health Care, Bed Weed Prevention). On job 2041
-- that is Root Rot Recovery at 12/yr, so its $20 becomes the $240 the book was
-- dropping.
insert into public.recurring_program_definitions
  (company_id, line_item_name, dept_prefix, is_recurring, program_group,
   visits_per_year, is_auxiliary, display_name)
values
  ('00000000-0000-0000-0000-000000000002', 'WF - Specialty Weed Control',
   'WF', true, null, null, true, 'Specialty Weed Control')
on conflict (company_id, line_item_name) do nothing;

-- NOT added, deliberately:
--   * WF - Lawn Health Care — Ben corrected job #2416 (Derek Carson) in Jobber on
--     2026-08-17 to Lawn Health Complete. The existing Complete row at 12/yr now
--     covers it, and the stale line item tombstones itself on the next sync.
--   * WF - Fire Ant Control and WF - Aeration — Jobber classifies these as ONE-OFF
--     jobs and they are absent from the recurring export, so the book is right to
--     leave them out. Aeration is priced $0 on 46 of 48 jobs anyway (bundled into a
--     program the customer already pays for). One-off work belongs in Visit Revenue,
--     not in the recurring book.

commit;
