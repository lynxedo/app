-- 2026-06-30_mix_sheet_visibility.sql
-- Per-product "show on mix sheet" toggle (Option A). When false, the product is
-- hidden from the Technician Mix Sheet ONLY — it still flows into pesticide
-- records, the route loadout, and inventory (because it is still applied).
-- Additive, defaults true so nothing changes for existing mappings.

ALTER TABLE public.service_products
  ADD COLUMN IF NOT EXISTS show_on_mix_sheet boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.service_products.show_on_mix_sheet IS
  'When false, hide this product from the Technician Mix Sheet only (still recorded + loaded + decremented).';
