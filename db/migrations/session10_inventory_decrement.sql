-- Master PRD Session 10 — Inventory stock & decrement.
-- Applied to the shared Supabase DB on 2026-06-19 via apply_migration `session10_inventory_decrement`.
-- All additive. Mirrors the Session 1–2 products RLS pattern (company SELECT via
-- get_my_company_id(); all writes go through the service-role admin client).

-- 1. Low-stock threshold per product (packages; same unit as product_location_inventory.quantity).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS reorder_threshold numeric;

-- 2. Movement ledger — every automatic decrement (and future receive/adjust) is an
--    audit row. The partial unique index makes a route's spray decrement idempotent
--    (each product consumed at most once per daily-log entry, even on reopen/re-complete).
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE CASCADE,
  delta       numeric NOT NULL,                 -- negative = consumed, positive = received/adjust-up
  reason      text NOT NULL,                    -- 'route_spray' | 'manual' | 'receive' | 'adjust'
  ref_type    text,                             -- e.g. 'daily_log_entry'
  ref_id      uuid,                             -- e.g. the daily_log_entries.id
  note        text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_route_spray_uniq
  ON public.inventory_movements (company_id, ref_type, ref_id, product_id)
  WHERE reason = 'route_spray';

CREATE INDEX IF NOT EXISTS inventory_movements_product_idx
  ON public.inventory_movements (company_id, product_id, created_at DESC);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_movements_select_company ON public.inventory_movements;
CREATE POLICY inventory_movements_select_company ON public.inventory_movements
  FOR SELECT USING (company_id = get_my_company_id());

-- 3. Per-company inventory settings: which location route-spray decrements from,
--    plus the low-stock alert recipients (mirrors fleet_settings).
CREATE TABLE IF NOT EXISTS public.inventory_settings (
  company_id               uuid PRIMARY KEY,
  deduct_location_id       uuid REFERENCES public.inventory_locations(id) ON DELETE SET NULL,
  low_stock_alerts_enabled boolean NOT NULL DEFAULT true,
  alert_recipient_user_ids uuid[] NOT NULL DEFAULT '{}',
  alert_recipient_room_ids uuid[] NOT NULL DEFAULT '{}',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_settings_select_company ON public.inventory_settings;
CREATE POLICY inventory_settings_select_company ON public.inventory_settings
  FOR SELECT USING (company_id = get_my_company_id());
