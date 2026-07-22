-- Shared Inbox — Hub rules layer ("Option C" hybrid: Outlook's own rules keep pre-filing
-- mail at the provider; this table adds a Hub-side rules engine for Hub concepts like
-- assignment, urgency, and auto-close). NOT YET APPLIED — the orchestrator applies it.
--
-- Design constraint: the engine is GENERIC — a rule is a typed `conditions` jsonb array
-- matched 'all'/'any', driving a typed `actions` jsonb array. Adding a new condition
-- field or action type later is an additive change (new literal in the app-side
-- allowlists), not a schema redesign. The engine skips unknown fields/ops/types.
--
--   conditions: [{ field, op, value }]
--     field: 'from_email' | 'from_name' | 'subject' | 'body' | 'to'   (extensible)
--     op:    'contains' | 'not_contains' | 'equals' | 'starts_with' | 'ends_with'
--   actions: [{ type, ...params }]
--     'assign_to_user'  { user_id }
--     'move_to_folder'  { provider_folder_id, folder_name }
--     'mark_urgent'     {}
--     'auto_close'      {}
--
-- RLS: service-role only (no anon/authenticated policies) — the admin API
-- (requireAdminArea('integrations')) mediates all access, matching inbox_accounts.

-- =====================================================================================
-- 1. inbox_rules
-- =====================================================================================
create table if not exists public.inbox_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  account_id uuid references public.inbox_accounts(id) on delete cascade,  -- null = applies to all mailboxes
  name text not null,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  match_mode text not null default 'all' check (match_mode in ('all','any')),
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  stop_processing boolean not null default false,     -- Outlook parity: matched + true → later rules skipped
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists inbox_rules_company_enabled_idx on public.inbox_rules (company_id, enabled, sort_order);

alter table public.inbox_rules enable row level security;
-- deliberately NO policies: service-role (admin client) only, like inbox_accounts.

-- =====================================================================================
-- 2. inbox_threads.urgent — set by the 'mark_urgent' rule action (verified absent from
--    the shared_inbox migration before adding).
-- =====================================================================================
alter table public.inbox_threads
  add column if not exists urgent boolean not null default false;
