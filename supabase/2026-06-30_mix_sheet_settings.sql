-- 2026-06-30_mix_sheet_settings.sql
-- Company-level Mix Sheet preferences. v1: product_order — a stable manual
-- column order (array of product_ids) the admin sets once; it applies across all
-- months. Columns whose product isn't listed fall to the end in default order.
-- One row per company.

CREATE TABLE IF NOT EXISTS public.mix_sheet_settings (
  company_id    uuid PRIMARY KEY,
  product_order jsonb NOT NULL DEFAULT '[]'::jsonb,  -- ordered product_ids
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mix_sheet_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mix_sheet_settings_select ON public.mix_sheet_settings;
CREATE POLICY mix_sheet_settings_select ON public.mix_sheet_settings
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());
