-- Allow sub-cent per-unit usage rates (Track 5 follow-up, 2026-07-30).
--
-- billing_catalog.unit_price_cents was an INTEGER (whole cents), so a usage rate like
-- $0.003/min (= 0.3 cents) could not be stored — it rounded to 0. Widen it to numeric so
-- fractional cents are preserved. Stripe bills these via a metered price's
-- `unit_amount_decimal`, which accepts a decimal cents value.
--
-- Lossless: every existing integer value (e.g. 5, 2, 25) becomes 5.000000 etc. — same
-- amount. Only the flat monthly prices stay integer cents (default_price_cents).
--
-- ⚠ Postgres numeric serializes to JS as a STRING (to preserve precision) — code that
-- reads unit_price_cents must Number()-coerce it (see lib/billing/provisioning.ts).
ALTER TABLE billing_catalog
  ALTER COLUMN unit_price_cents TYPE numeric(12,6)
  USING unit_price_cents::numeric;
