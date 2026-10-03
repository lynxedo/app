-- Work Orders Phase 2 (Part 1) — line items on the work order → the Jobber VISIT.
-- PRD: Reference/PRDs/WORK_ORDERS_AND_QUOTES_PRD.md §6 Phase 2. Oct 3, 2026.
--
-- Verified against Heroes' Jobber on test jobs #2694/#2695 (Oct 2):
--  • visitEditLineItems on a visit still showing the job's shared line item FORKS
--    a visit-only copy (new id); visitCreateLineItems adds a visit-only item.
--    Other visits of a recurring job are untouched.
--  • Both come back taxable=true and unlinked from the catalog whatever we send,
--    so the push follows each with jobEditLineItems on the NEW id (taxable +
--    productOrServiceId), which changes only that visit.
--  • Jobber also lists those visit-only items on the JOB — the mirror skips them
--    (visit_only below) so recurring-book reports don't double-count.
--  • Autopay jobs are invoiced + charged within ~1 min of visitComplete from the
--    VISIT's line items — so every item lands before visitComplete is called.
--
-- ADDITIVE. Applied via Supabase MCP apply_migration
-- `work_orders_line_items_2026_10_03`.

create table if not exists public.work_order_line_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  stop_id uuid not null references public.daily_log_stops(id) on delete cascade,
  -- jobber = was on the Jobber visit; tech_added = picked from the catalog on the
  -- stop; inspection_suggested = proposed by an inspection rule (Part 2).
  source text not null check (source in ('jobber', 'tech_added', 'inspection_suggested')),
  -- proposed = a suggestion not yet accepted (never sent to Jobber);
  -- accepted = on the work order; dismissed = a suggestion the tech turned down.
  status text not null default 'accepted' check (status in ('proposed', 'accepted', 'dismissed')),
  name text not null,
  description text,
  quantity numeric not null default 1,
  unit_price numeric not null default 0,
  taxable boolean,
  -- What Jobber had when the row was seeded/last refreshed (source='jobber'):
  -- a difference from quantity/unit_price = "changed by the tech".
  orig_quantity numeric,
  orig_unit_price numeric,
  jobber_line_item_id text,          -- this item's CURRENT id on the Jobber visit
  -- the shared job item this one was forked from (so a mirror that still shows
  -- the old id doesn't re-seed it as a second row). Added by
  -- `work_orders_line_items_replaced_id_2026_10_03`.
  replaced_jobber_line_item_id text,
  jobber_product_id text,            -- catalog link (ProductOrService id)
  visit_only boolean not null default false, -- Hub created/forked it on this visit only
  -- synced = Jobber matches; pending = waiting for Complete; error = a push failed
  sync_state text not null default 'synced' check (sync_state in ('synced', 'pending', 'error')),
  sync_error text,
  sync_attempts integer not null default 0,
  synced_at timestamptz,
  suggestion_rule_id uuid,           -- Part 2
  suggestion_note text,              -- Part 2: why it was suggested ("Zone 3: broken head")
  added_by uuid,
  edited_by uuid,
  edited_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists work_order_line_items_stop_idx
  on public.work_order_line_items (stop_id) where deleted_at is null;
create index if not exists work_order_line_items_unsynced_idx
  on public.work_order_line_items (company_id, sync_state) where deleted_at is null and sync_state <> 'synced';
create index if not exists work_order_line_items_visit_only_idx
  on public.work_order_line_items (jobber_line_item_id) where visit_only and jobber_line_item_id is not null;

alter table public.work_order_line_items enable row level security;

-- Reads: anyone in the company. Writes go through the admin client in the API
-- routes, which verify the stop's company first.
drop policy if exists work_order_line_items_select on public.work_order_line_items;
create policy work_order_line_items_select on public.work_order_line_items
  for select to authenticated
  using (company_id in (select company_id from public.user_profiles where id = auth.uid()));

-- Per-tech favorites + recents for the catalog picker.
create table if not exists public.work_order_catalog_usage (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null,
  jobber_product_id text not null,
  product_name text,
  use_count integer not null default 0,
  last_used_at timestamptz,
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, jobber_product_id)
);

alter table public.work_order_catalog_usage enable row level security;

drop policy if exists work_order_catalog_usage_select on public.work_order_catalog_usage;
create policy work_order_catalog_usage_select on public.work_order_catalog_usage
  for select to authenticated
  using (user_id = auth.uid());

-- The stop's Jobber completion, now that it waits on the line items.
alter table public.daily_log_stops
  add column if not exists jobber_complete_pending boolean not null default false,
  add column if not exists jobber_completed_at timestamptz,
  add column if not exists jobber_complete_error text,
  add column if not exists jobber_autopay boolean,
  add column if not exists jobber_sync_lock_at timestamptz,
  add column if not exists line_items_reviewed_at timestamptz,
  add column if not exists line_items_reviewed_by uuid;
