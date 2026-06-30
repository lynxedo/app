-- 2026-06-30_dated_service_mixes.sql
-- Mix Sheet work, Phase A: date-bounded product mixes per Jobber line item.
--
-- Each service_products row gains a date window (effective_start/effective_end),
-- an "OR-alternate" group label (alt_group), and a display batch_label. A "mix /
-- batch" for a line item = the rows that share a date window. Consumers (the
-- pesticide-record matcher in lib/pesticide.ts and the route loadout in
-- lib/route-capacity.ts) pick, per line item, the batch whose window contains the
-- service date — preferring a dated batch over the un-dated/always rows. Existing
-- rows have NULL dates, so today's behaviour is preserved until Ben adds batches.
--
-- Fully additive: new nullable columns + an index relax (the old "one product per
-- line item" unique index is replaced with one that also keys on the batch start,
-- so a product can repeat across batches but not within one). Non-destructive.

ALTER TABLE public.service_products
  ADD COLUMN IF NOT EXISTS effective_start date,
  ADD COLUMN IF NOT EXISTS effective_end   date,
  ADD COLUMN IF NOT EXISTS alt_group       text,
  ADD COLUMN IF NOT EXISTS batch_label     text;

COMMENT ON COLUMN public.service_products.effective_start IS 'Mix batch start (inclusive); NULL = open-ended / always-on';
COMMENT ON COLUMN public.service_products.effective_end   IS 'Mix batch end (inclusive); NULL = open-ended';
COMMENT ON COLUMN public.service_products.alt_group       IS 'Products sharing this label within a line item + batch are OR-alternatives on the mix sheet';
COMMENT ON COLUMN public.service_products.batch_label     IS 'Display name for the mix batch, e.g. "Round 5 — July 2026"';

-- The same product can now appear across multiple dated batches for one line item.
-- Replace the (duplicated) product-once-per-line-item unique index with one that
-- also keys on the batch start, so duplicates are still blocked WITHIN a batch.
-- COALESCE keeps the original protection intact for un-dated (NULL-start) rows.
DROP INDEX IF EXISTS public.service_products_line_item_product_uniq;
DROP INDEX IF EXISTS public.service_products_uk;
CREATE UNIQUE INDEX service_products_uk
  ON public.service_products
     (company_id, jobber_line_item_name, product_id, (COALESCE(effective_start, '-infinity'::date)))
  WHERE deleted_at IS NULL;

-- Fast lookup of the active batch for a line item on a given date.
CREATE INDEX IF NOT EXISTS service_products_date_idx
  ON public.service_products (company_id, jobber_line_item_name, effective_start, effective_end)
  WHERE deleted_at IS NULL;
