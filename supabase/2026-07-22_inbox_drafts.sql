-- Shared Inbox — Drafts (Step 2a) + scheduled-send columns (Step 2b, unused until then).
-- APPLIED to the shared staging+prod DB via Supabase MCP apply_migration `inbox_drafts_2026_07_22`.
-- Additive: one new table. Drafts are per-user WIP composes; RLS = own drafts only. Writes are
-- service-role (the API gates account access per action, mirroring the rest of the inbox).

create table if not exists public.inbox_drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  account_id uuid not null references public.inbox_accounts(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  thread_id uuid references public.inbox_threads(id) on delete cascade, -- null = new compose
  kind text not null default 'new',              -- 'new' | 'reply' | 'reply-all' | 'forward'
  reply_to_message_id text,                      -- provider message id for reply threading
  to_recipients jsonb not null default '[]'::jsonb,   -- [{name,email}]
  cc_recipients jsonb not null default '[]'::jsonb,
  bcc_recipients jsonb not null default '[]'::jsonb,
  subject text,
  body_html text,                                -- the editor's HTML (restored as initial content)
  attachments jsonb not null default '[]'::jsonb, -- staged R2 outbox metas [{id,filename,contentType,size}]
  scheduled_at timestamptz,                      -- (Step 2b) scheduled-send time; null = plain draft
  nylas_schedule_id text,                        -- (Step 2b) provider schedule id, for cancel
  status text not null default 'draft',          -- 'draft' | 'scheduled' | 'sent' | 'cancelled' | 'failed'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists inbox_drafts_user_idx on public.inbox_drafts (created_by, updated_at desc);
create index if not exists inbox_drafts_account_idx on public.inbox_drafts (account_id);
create index if not exists inbox_drafts_thread_idx on public.inbox_drafts (thread_id);
create index if not exists inbox_drafts_scheduled_idx on public.inbox_drafts (status, scheduled_at)
  where scheduled_at is not null;

alter table public.inbox_drafts enable row level security;
drop policy if exists inbox_drafts_select on public.inbox_drafts;
create policy inbox_drafts_select on public.inbox_drafts for select to authenticated
using (
  created_by = auth.uid()
  and company_id in (select company_id from public.user_profiles where id = auth.uid())
);
