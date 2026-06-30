-- 2026-06-30_mix_sheets.sql
-- Technician Mix Sheet, Phase B: per-period sheet config.
--
-- The grid itself is derived LIVE from the dated mixes in service_products
-- (Phase A) — nothing about products/rates is stored here. This table only
-- persists the per-month editable bits: which programs are shown, the Notes,
-- the Granular Options box, and (reserved) future per-product overrides.
-- One row per (company, period_key = 'YYYY-MM').

CREATE TABLE IF NOT EXISTS public.mix_sheets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  period_key        text NOT NULL,                       -- 'YYYY-MM'
  label             text,                                -- e.g. 'July 2026'
  selected_programs jsonb,                               -- array of program keys; null/empty = all
  notes             text,
  granular_options  text,
  overrides         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- reserved: per-product rate/hide overrides
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_key)
);

ALTER TABLE public.mix_sheets ENABLE ROW LEVEL SECURITY;

-- Company-scoped read for signed-in users; writes go through the service role
-- (no write policy), mirroring inventory_settings / tank_configs.
DROP POLICY IF EXISTS mix_sheets_select ON public.mix_sheets;
CREATE POLICY mix_sheets_select ON public.mix_sheets
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());
