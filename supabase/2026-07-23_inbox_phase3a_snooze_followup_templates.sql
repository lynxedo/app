-- Shared Inbox — Roadmap v2 Phase 3A: Snooze + Follow-up reminders + Templates.
-- APPLIED to the shared DB via Supabase MCP `inbox_phase3a_2026_07_23`. 100% ADDITIVE.

-- =====================================================================================================
-- 1. Snooze — hide a thread until a time, then it AUTO-returns to the active list. No cron needed:
--    active views filter out `snoozed_until > now()`; when the time passes the row reappears.
-- =====================================================================================================
alter table public.inbox_threads add column if not exists snoozed_until timestamptz;
alter table public.inbox_threads add column if not exists snoozed_by uuid references auth.users(id) on delete set null;
create index if not exists inbox_threads_snoozed_idx on public.inbox_threads (company_id, snoozed_until)
  where snoozed_until is not null and deleted_at is null;

-- =====================================================================================================
-- 2. Follow-up reminders — nudge `follow_up_by` at `follow_up_at` if the thread is still unresolved.
--    Fired by a cron sweep (app/api/hub/email/followup-check), deduped by follow_up_notified_at.
-- =====================================================================================================
alter table public.inbox_threads add column if not exists follow_up_at timestamptz;
alter table public.inbox_threads add column if not exists follow_up_by uuid references auth.users(id) on delete set null;
alter table public.inbox_threads add column if not exists follow_up_note text;
alter table public.inbox_threads add column if not exists follow_up_notified_at timestamptz;
create index if not exists inbox_threads_followup_idx on public.inbox_threads (follow_up_at)
  where follow_up_at is not null and follow_up_notified_at is null and deleted_at is null;

-- =====================================================================================================
-- 3. inbox_templates — company-shared canned responses (managers curate, everyone inserts).
--    Service-role only (read via a GET route behind a hasAccess gate, like inbox_tags).
-- =====================================================================================================
create table if not exists public.inbox_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  subject text,                                      -- optional; some templates set a subject too
  body_html text not null default '',
  sort_order integer not null default 0,
  active boolean not null default true,              -- "delete" = deactivate
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists inbox_templates_company_idx on public.inbox_templates (company_id, sort_order);
alter table public.inbox_templates enable row level security;
-- deliberately NO policies: service-role (admin client) only.
