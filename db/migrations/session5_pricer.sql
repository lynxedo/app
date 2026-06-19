-- Session 5 (Pricer) — presentation columns on program_price_charts.
-- Applied to the shared Supabase DB on 2026-06-19 via MCP (migration
-- `session5_pricer_presentation_cols`). Recorded here for repo traceability.
--
-- Additive only. The Pricer (/hub/pricer) sections + orders published programs by
-- these. The Service Builder's parseChartBody whitelist does NOT include them, so a
-- republish through the Builder never overwrites them (verified Session 5).
--   • category  : 'annual' | 'onetime' | 'addon' (null → Pricer "Other" bucket)
--   • sort_order: lower-first within a category (recommend multiples of 10)
-- A future Builder session can expose these for editing. See
-- Hub/PRODUCTS_PRICING_AND_OPS_MASTER_PRD.md §11 Session 5.

alter table public.program_price_charts
  add column if not exists category   text,
  add column if not exists sort_order integer not null default 0;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'program_price_charts_category_chk') then
    alter table public.program_price_charts
      add constraint program_price_charts_category_chk
      check (category is null or category in ('annual','onetime','addon'));
  end if;
end $$;
