-- Shared Inbox — Roadmap v2 Phase 1: event-driven (webhook) sync + self-healing + tombstoning + open tracking.
-- APPLIED to the shared staging+prod DB via Supabase MCP apply_migration `inbox_webhooks_phase1_2026_07_23`.
-- 100% ADDITIVE (new table + nullable/defaulted columns) → no existing data touched, no prod behavior change
-- until the Phase 1 code deploys. See Hub/SHARED_INBOX_PRD.md "🚀 Roadmap v2 — 2026-07-23" Phase 1.

-- =====================================================================================================
-- 1. inbox_events_raw — durable webhook event log + idempotency spine.
--    Every inbound Nylas notification is written here FIRST (never lose one), then processed async.
--    Idempotent on the Nylas notification id. Service-role only (like inbox_accounts) — no RLS policies.
-- =====================================================================================================
create table if not exists public.inbox_events_raw (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'nylas',
  event_id text,                                     -- Nylas notification id (dedupe key; null-tolerant)
  trigger_type text,                                 -- e.g. 'message.created' | 'grant.expired' | 'message.opened'
  grant_id text,                                     -- Nylas grant id the event belongs to (maps → inbox_accounts)
  company_id uuid references public.companies(id),   -- resolved from grant_id when known
  payload jsonb not null default '{}'::jsonb,        -- the full webhook body
  status text not null default 'received',           -- 'received' | 'processed' | 'skipped' | 'error'
  process_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
-- Idempotency: a repeated delivery of the same notification id is ignored.
create unique index if not exists inbox_events_raw_event_id_key
  on public.inbox_events_raw (provider, event_id) where event_id is not null;
create index if not exists inbox_events_raw_status_idx on public.inbox_events_raw (status, received_at);
create index if not exists inbox_events_raw_grant_idx on public.inbox_events_raw (grant_id);
alter table public.inbox_events_raw enable row level security;
-- deliberately NO policies: service-role (admin client) only.

-- =====================================================================================================
-- 2. Tombstoning — soft-delete columns so a delete/move in the real mailbox reflects in Hub.
--    The reconcile pass sets deleted_at on rows the provider no longer returns; all read queries filter
--    `deleted_at is null`. Never a hard DELETE (mirrors the platform's soft-delete convention).
-- =====================================================================================================
alter table public.inbox_threads  add column if not exists deleted_at timestamptz;
alter table public.inbox_messages add column if not exists deleted_at timestamptz;
alter table public.inbox_folders  add column if not exists deleted_at timestamptz;
create index if not exists inbox_threads_live_idx  on public.inbox_threads  (company_id, is_shared, status, last_message_at desc) where deleted_at is null;

-- =====================================================================================================
-- 3. Open tracking (Decision K) + delivery/bounce status (uses the bounce detection already on the plan).
--    Recorded on the OUTBOUND message via the message.opened / message.bounced|rejected|complaint webhooks.
-- =====================================================================================================
alter table public.inbox_messages add column if not exists opened_at timestamptz;              -- first open
alter table public.inbox_messages add column if not exists open_count integer not null default 0;
alter table public.inbox_messages add column if not exists tracking_enabled boolean not null default false; -- sender opted this message into open tracking
alter table public.inbox_messages add column if not exists delivery_status text;               -- null | 'delivered' | 'bounced' | 'rejected' | 'complaint'
alter table public.inbox_messages add column if not exists delivery_detail text;

-- =====================================================================================================
-- 4. Grant-health self-heal — dedupe the "reconnect this mailbox" nudge so we don't ping every poll.
--    (Account already has status 'connected'|'action_needed'|'disconnected' + last_error; add a notified stamp.)
-- =====================================================================================================
alter table public.inbox_accounts add column if not exists reconnect_notified_at timestamptz;

-- =====================================================================================================
-- 5. Webhook subscription bookkeeping (which Nylas webhook id we registered, per app/env).
--    Optional single-row-per-app record so we can show status + avoid duplicate registration.
-- =====================================================================================================
create table if not exists public.inbox_webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'nylas',
  webhook_id text,                                   -- Nylas webhook id
  callback_url text,
  trigger_types text[] not null default '{}',
  status text not null default 'active',             -- 'active' | 'failing' | 'revoked'
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, webhook_id)
);
alter table public.inbox_webhook_subscriptions enable row level security;
-- service-role only.
