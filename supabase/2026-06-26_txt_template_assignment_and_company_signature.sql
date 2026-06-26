-- Txt: per-user org-template assignment + company signature settings.
-- All additive (new nullable column / new column with default) — safe on the
-- shared prod+staging DB; existing code ignores the new fields until shipped.

-- 1) Per-user assignment for ORG templates.
--    Empty array  = visible to everyone in the company (the default, unchanged
--    behavior). Non-empty = only the listed users see it in the composer picker.
--    Modeled like media (text[]) — read inline with the template row, no junction
--    table, no new RLS (the row is already SELECT-able by same-company users).
ALTER TABLE public.txt_templates
  ADD COLUMN IF NOT EXISTS assigned_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

-- 2) Company-wide default signature + whether users may set their own.
ALTER TABLE public.txt_settings
  ADD COLUMN IF NOT EXISTS company_default_signature text;

ALTER TABLE public.txt_settings
  ADD COLUMN IF NOT EXISTS allow_user_signatures boolean NOT NULL DEFAULT true;
