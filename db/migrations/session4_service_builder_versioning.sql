-- Session 4 (Service Builder) — versioning layer on program_price_charts.
-- Applied to the shared Supabase DB on 2026-06-19 via MCP (migration
-- `session4_service_builder_versioning`). Recorded here for repo traceability.
--
-- Additive only. Lets a program hold multiple versions (e.g. 2026 live + 2027 plan):
--   • draft  versions never feed the Pricer (free to tinker)
--   • published versions are live; effective_from schedules a future activation
--   • archived versions are kept for history
-- See Hub/PRODUCTS_PRICING_AND_OPS_MASTER_PRD.md §8.5.

alter table public.program_price_charts
  add column if not exists version_label    text,
  add column if not exists status           text not null default 'draft',
  add column if not exists effective_from   date,
  add column if not exists builder_settings jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'program_price_charts_status_chk') then
    alter table public.program_price_charts
      add constraint program_price_charts_status_chk
      check (status in ('draft','published','archived'));
  end if;
end $$;

-- One version_label per (company, program). Tombstone-safe.
create unique index if not exists program_price_charts_company_program_version_uniq
  on public.program_price_charts (company_id, program_key, version_label)
  where deleted_at is null;

-- Pricer lookup (Session 5): published, currently-effective charts per program.
create index if not exists program_price_charts_lookup_idx
  on public.program_price_charts (company_id, program_key, status, effective_from)
  where deleted_at is null;
