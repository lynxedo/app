-- Shared Inbox — Roadmap v2 Phase 4A: Saved/smart views.
-- APPLIED to the shared DB via Supabase MCP `inbox_saved_views_2026_07_23`. 100% ADDITIVE.
-- (Body/full-text search is a route change only — no schema. Trigram index deliberately skipped
--  for now; company-scoped bounded ilike is fine at current volume — revisit if search slows.)

-- Per-USER saved views: a named bundle of the current list filters (scope/tag/waiting/folder/
-- search/snoozed) so a rep can one-click "My open complaints", "Unassigned quotes > 4h", etc.
create table if not exists public.inbox_saved_views (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  config jsonb not null default '{}'::jsonb,   -- { scope?, tag?, waiting?, folder?, search?, snoozed? }
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
create index if not exists inbox_saved_views_user_idx on public.inbox_saved_views (user_id, sort_order);
alter table public.inbox_saved_views enable row level security;
-- service-role only (read via a GET route scoped to the caller's user_id, like the other inbox_* tables).
