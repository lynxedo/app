-- Session 6 (Service mapping & current-round selection) — safety indexes.
-- Applied to the shared Supabase DB on 2026-06-19 via MCP (migration
-- `session6_service_mapping_indexes`). Recorded here for repo traceability.
--
-- Additive only. The service_products + product_rounds tables already exist
-- (Session 2). These two partial unique indexes enforce the invariants the
-- admin UI relies on:
--   • at most ONE current round per program (the active round the Pricer/
--     Route Capacity/Pesticide paths read)
--   • no duplicate (line item → product) mapping row
-- Both ignore soft-deleted tombstones (WHERE deleted_at IS NULL) so re-creating
-- a mapping/round the UI hides never trips a stale "already exists".

create unique index if not exists product_rounds_one_current_per_program
  on public.product_rounds (company_id, program)
  where is_current and deleted_at is null;

create unique index if not exists service_products_line_item_product_uniq
  on public.service_products (company_id, jobber_line_item_name, product_id)
  where deleted_at is null;

-- Distinct Jobber line-item names + usage counts, for the Service Mapping
-- autocomplete (228 names across ~19.6k rows — aggregate in the DB, not the app).
-- SECURITY INVOKER (default) so it still respects line_items RLS; the admin route
-- is the only caller. REVOKE public/anon + GRANT authenticated as a guard.
create or replace function public.service_mapping_line_item_names(p_company_id uuid)
returns table(name text, uses bigint)
language sql
stable
as $function$
  select name, count(*) as uses
  from public.line_items
  where company_id = p_company_id and deleted_at is null and name is not null and name <> ''
  group by name
  order by count(*) desc, name asc
$function$;

revoke all on function public.service_mapping_line_item_names(uuid) from public, anon;
grant execute on function public.service_mapping_line_item_names(uuid) to authenticated;
