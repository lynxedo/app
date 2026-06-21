-- Test-findings fix #3 — tank assignment lost Optimizer → Daily Log v2.
-- The optimizer's per-route tank choices (product_id → tank_number) weren't
-- carried into the parked batch, so the from-route loadout snapshot fell back to
-- service_products.tank_default (null) and DL v2 showed tank "—" / 0% bars.
-- Snapshot the overrides on the batch so they flow through to the stored loadout.
-- Additive, nullable — safe.
alter table public.route_batches add column if not exists tank_overrides jsonb;
comment on column public.route_batches.tank_overrides is
  'Snapshot of per-route tank assignments (product_id -> tank_number) from the optimizer, so Daily Log v2 loadout keeps the tank choices. Test-findings fix #3.';
