-- Work Orders Phase 2 (Part 2) — "Suggested from inspection". Oct 3, 2026.
-- An admin-kept list of plain rules: when a finished irrigation inspection tied
-- to a stop matches, Hub proposes a catalog line item on that stop. Nothing is
-- sent to Jobber until the tech taps Add (PRD §6 Phase 2). Rules, not AI — honest,
-- auditable, and editable by Ben on the Work Orders office page.
--
-- trigger_kind:
--   zone_issue — a zone's "issues" text contains trigger_text (any of several,
--                comma-separated), optionally only on zones whose head type
--                contains head_filter (Spray / Rotor / Drip …)
--   field      — an inspection field equals trigger_value
--                (trigger_field ∈ bfCond, ctrlBatt, prv, overallCond, bfInsul, ctrlWifi)
-- quantity_mode:
--   number_in_text — the number written just before the keyword ("2 broken heads" → 2), else 1, summed over zones
--   per_zone       — 1 for each matching zone
--   fixed          — fixed_quantity
--
-- ADDITIVE. Applied via Supabase MCP apply_migration
-- `work_orders_suggestion_rules_2026_10_03`.

create table if not exists public.inspection_suggestion_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  trigger_kind text not null check (trigger_kind in ('zone_issue', 'field')),
  trigger_text text,
  head_filter text,
  trigger_field text,
  trigger_value text,
  jobber_product_id text not null,
  product_name text not null,
  quantity_mode text not null default 'fixed' check (quantity_mode in ('number_in_text', 'per_zone', 'fixed')),
  fixed_quantity numeric not null default 1,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists inspection_suggestion_rules_company_idx
  on public.inspection_suggestion_rules (company_id) where deleted_at is null;

alter table public.inspection_suggestion_rules enable row level security;

drop policy if exists inspection_suggestion_rules_select on public.inspection_suggestion_rules;
create policy inspection_suggestion_rules_select on public.inspection_suggestion_rules
  for select to authenticated
  using (company_id in (select company_id from public.user_profiles where id = auth.uid()));
