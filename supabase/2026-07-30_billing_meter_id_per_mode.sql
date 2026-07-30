-- Per-mode Stripe Billing Meter ids (Track 5 go-live prereq, 2026-07-30).
--
-- Stripe Billing Meters are per-mode (test vs live are separate objects), but the catalog
-- had a single stripe_meter_id column — so a LIVE metered price would try to reference a
-- TEST meter and fail. Split into stripe_meter_id_test / _live (mirroring the price id
-- columns). The legacy stripe_meter_id column is left in place (unused going forward).
--
-- Existing meter ids are all test-mode (mtr_test_…) from the M4.5 test provisioning, so
-- move them into the test column. Lossless + additive.
ALTER TABLE billing_catalog ADD COLUMN IF NOT EXISTS stripe_meter_id_test text;
ALTER TABLE billing_catalog ADD COLUMN IF NOT EXISTS stripe_meter_id_live text;

UPDATE billing_catalog
  SET stripe_meter_id_test = stripe_meter_id
  WHERE stripe_meter_id IS NOT NULL
    AND stripe_meter_id LIKE 'mtr_test_%'
    AND stripe_meter_id_test IS NULL;
