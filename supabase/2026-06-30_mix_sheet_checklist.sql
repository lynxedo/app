-- 2026-06-30_mix_sheet_checklist.sql
-- Per-month Inspect/Treat checklist for the Mix Sheet (PHC / BWP × BP / RC).
-- Stored as a flat jsonb map keyed "ITEM.ROUTE.ACTION" -> bool, e.g. "PHC.BP.Treat".
-- (Per-month rate overrides reuse the existing mix_sheets.overrides jsonb.)
-- Additive, defaults '{}'.

ALTER TABLE public.mix_sheets
  ADD COLUMN IF NOT EXISTS checklist jsonb NOT NULL DEFAULT '{}'::jsonb;
