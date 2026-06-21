-- Master PRD Session 9 — Pesticide automation (Jobber VISIT_COMPLETE webhook → unified pesticide_records)
-- Applied to the shared Supabase DB on 2026-06-19 via apply_migration `session9_pesticide_visit_dedup`.
--
-- Dedup key so the Daily Log V2 stop-complete path and the Jobber VISIT_COMPLETE
-- webhook write exactly ONE record per visit (PRD §8.8 "deduped on jobber_visit_id").
-- Partial (nulls excluded) so non-Jobber stops can still insert freely.
CREATE UNIQUE INDEX IF NOT EXISTS pesticide_records_company_visit_uniq
  ON public.pesticide_records (company_id, jobber_visit_id)
  WHERE jobber_visit_id IS NOT NULL;
