-- Quotes (Work Orders PRD Phase 4) session 3: the builder.
-- ADDITIVE / relaxing only, applied while quote_line_items had 0 rows.
--  * A line copied from a template with a blank price stays unpriced (NULL)
--    until the builder fills it in; Send refuses a quote with an unpriced line.
--  * quotes.lawn_size_k = the size the quote was priced on (from the property,
--    editable in the builder) — kept for the record.
alter table public.quote_line_items alter column unit_price drop not null;
alter table public.quote_line_items alter column unit_price drop default;
alter table public.quotes add column if not exists lawn_size_k numeric(10,2);
