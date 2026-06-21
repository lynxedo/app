-- Session 7 (Route Capacity Parts A–C). Additive only — applied to the shared
-- Supabase DB on 2026-06-19 via the Supabase MCP.
--
-- The Session 2 tables (tank_configs, route_tank_assignments) already exist and
-- are seeded. This migration only adds the unique key that lets per-route/day
-- tank assignments (Part B) UPSERT a product's tank choice for a route on a day:
-- one row per (company, route, day, product). Falls back to
-- service_products.tank_default when no override row exists.
CREATE UNIQUE INDEX IF NOT EXISTS route_tank_assignments_uk
  ON public.route_tank_assignments (company_id, route_code, run_date, product_id);
