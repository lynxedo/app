-- Per-subscriber, per-module discount percentage (Track 5 follow-up, 2026-07-30).
--
-- Adds a discount_percent column to the existing per-tenant pricing overrides. A value
-- of 0..100 (numeric, up to 2 decimals) means "take X% off this module's monthly fee for
-- this tenant"; NULL means no discount (inherit the catalog default, i.e. full price).
--
-- Purely additive; company_billing_overrides is service-role only (no RLS change needed).
-- Existing rows get NULL (= no discount), so behavior is unchanged until a value is set.
ALTER TABLE company_billing_overrides
  ADD COLUMN IF NOT EXISTS discount_percent numeric(5,2);

-- Guard the range at the DB level so a bad write can never store a nonsensical percent.
ALTER TABLE company_billing_overrides
  DROP CONSTRAINT IF EXISTS company_billing_overrides_discount_percent_range;
ALTER TABLE company_billing_overrides
  ADD CONSTRAINT company_billing_overrides_discount_percent_range
  CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100));
