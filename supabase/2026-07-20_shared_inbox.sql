-- Shared Inbox (Hub "Inbox" / Hub Email) — data model + RLS + permission flags
-- APPLIED to the shared staging+prod DB via Supabase MCP apply_migration `shared_inbox_2026_07_20`.
-- Feature ships DARK: no deployed code reads these tables until the /hub/email build lands on staging
-- and the shared hlc105 mailbox is connected via Nylas.
--
-- Transport: Nylas email API aggregator (swappable). Nylas holds the mailbox OAuth credentials, so we
-- store only a per-mailbox `nylas_grant_id` (not access/refresh tokens) + one app-level NYLAS_API_KEY env.
--
-- Naming: `inbox_*` prefix, deliberately separate from the existing `email_*` Email-Marketing namespace.
--
-- RLS model (mirrors Txt: read-isolation only; all writes go through the service-role admin client with
-- per-action authorization in the route handlers) — BUT stricter for the technician thread-scoped boundary,
-- which is enforced at the database level (PRD Decision C), not just in the UI.

-- =====================================================================================================
-- 1. Permission flags on user_profiles
-- =====================================================================================================
alter table public.user_profiles
  add column if not exists can_access_shared_inbox boolean not null default false;   -- full manager/office access to the shared inbox
alter table public.user_profiles
  add column if not exists can_compose_shared_email boolean not null default false;  -- lighter grant: a tech may start a new outbound as hlc105
alter table public.user_profiles
  add column if not exists email_signature text;                                     -- per-user signature (mirrors txt_signature)

-- =====================================================================================================
-- 2. inbox_accounts — connected mailboxes (shared hlc105 + personal). Service-role only (like qbo_tokens).
--    grant_id is never exposed to the client; the UI learns about accounts through server code / denormalized cols.
-- =====================================================================================================
create table if not exists public.inbox_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  provider text not null default 'nylas',            -- transport provider (swappable layer)
  underlying_provider text,                          -- what Nylas connected to: 'microsoft' | 'google' | 'imap'
  nylas_grant_id text,                               -- Nylas grant id (mailbox handle); the API key is the secret, held in env
  account_type text not null check (account_type in ('shared','personal')),
  email_address text not null,
  display_name text,
  owner_user_id uuid references auth.users(id) on delete set null,   -- null for shared; the connecting user for personal
  sync_cursor text,                                  -- Nylas page cursor / delta token
  last_synced_at timestamptz,
  last_error text,
  status text not null default 'connected',          -- 'connected' | 'action_needed' | 'disconnected'
  active boolean not null default true,
  connected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, email_address),
  unique (nylas_grant_id)
);
create index if not exists inbox_accounts_company_idx on public.inbox_accounts (company_id);
create index if not exists inbox_accounts_owner_idx on public.inbox_accounts (owner_user_id);
alter table public.inbox_accounts enable row level security;
-- deliberately NO policies: service-role (admin client) only, like gusto_connections / qbo_tokens.

-- =====================================================================================================
-- 3. inbox_threads — mirrored conversations
-- =====================================================================================================
create table if not exists public.inbox_threads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  account_id uuid not null references public.inbox_accounts(id) on delete cascade,
  provider_thread_id text not null,
  subject text,
  snippet text,
  last_message_at timestamptz,
  last_message_direction text,                       -- 'inbound' | 'outbound' (powers "Needs a reply")
  from_name text,
  from_email text,
  participants jsonb not null default '[]'::jsonb,    -- [{name,email}]
  assigned_to_user_id uuid references auth.users(id) on delete set null,  -- shared only; cached owner pointer (source of truth = inbox_thread_members)
  status text not null default 'open',               -- 'open' | 'assigned' | 'closed'
  is_shared boolean not null default true,           -- true = shared hlc105 thread; false = personal
  owner_user_id uuid references auth.users(id) on delete set null,        -- personal thread owner (null for shared) — used by RLS
  unread boolean not null default false,
  folder text,                                       -- current folder display name
  provider_folder_ids text[] not null default '{}',
  has_attachments boolean not null default false,
  contact_id uuid references public.txt_contacts(id) on delete set null,  -- best-effort unified-directory link (by email)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider_thread_id)
);
create index if not exists inbox_threads_queue_idx on public.inbox_threads (company_id, is_shared, status, last_message_at desc);
create index if not exists inbox_threads_account_idx on public.inbox_threads (account_id);
create index if not exists inbox_threads_assigned_idx on public.inbox_threads (assigned_to_user_id);
create index if not exists inbox_threads_owner_idx on public.inbox_threads (owner_user_id);
create index if not exists inbox_threads_needsreply_idx on public.inbox_threads (company_id, status, last_message_direction, last_message_at);

-- =====================================================================================================
-- 4. inbox_messages — mirrored messages (metadata + cached body)
-- =====================================================================================================
create table if not exists public.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  thread_id uuid not null references public.inbox_threads(id) on delete cascade,
  account_id uuid not null references public.inbox_accounts(id) on delete cascade,
  provider_message_id text not null,
  direction text not null,                           -- 'inbound' | 'outbound'
  from_name text,
  from_email text,
  to_recipients jsonb not null default '[]'::jsonb,  -- [{name,email}]
  cc_recipients jsonb not null default '[]'::jsonb,
  bcc_recipients jsonb not null default '[]'::jsonb,
  subject text,
  snippet text,
  body_html text,
  body_text text,
  message_date timestamptz,
  unread boolean not null default false,
  has_attachments boolean not null default false,
  attachments jsonb not null default '[]'::jsonb,    -- [{id,filename,content_type,size,is_inline}]
  sent_by_user_id uuid references auth.users(id) on delete set null,  -- staff author for Hub-sent outbound
  provider_folder_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (account_id, provider_message_id)
);
create index if not exists inbox_messages_thread_idx on public.inbox_messages (thread_id, message_date);
create index if not exists inbox_messages_company_idx on public.inbox_messages (company_id);

-- =====================================================================================================
-- 5. inbox_thread_members — visibility/assignment spine (mirrors txt_conversation_members).
--    One row = one user granted a thread. role 'owner' (claim/assign) or 'member' (shared to a tech).
-- =====================================================================================================
create table if not exists public.inbox_thread_members (
  thread_id uuid not null references public.inbox_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',               -- 'owner' | 'member'
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);
create index if not exists inbox_thread_members_user_idx on public.inbox_thread_members (user_id);

-- =====================================================================================================
-- 6. inbox_notes — internal team notes (mirrors txt_notes). Never sent to the customer.
-- =====================================================================================================
create table if not exists public.inbox_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  thread_id uuid not null references public.inbox_threads(id) on delete cascade,
  body text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists inbox_notes_thread_idx on public.inbox_notes (thread_id, created_at);

-- =====================================================================================================
-- 7. inbox_thread_events — activity/audit feed
-- =====================================================================================================
create table if not exists public.inbox_thread_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  thread_id uuid not null references public.inbox_threads(id) on delete cascade,
  event_type text not null,                          -- assigned|claimed|closed|reopened|replied|shared|unshared|note|opened
  actor_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists inbox_thread_events_thread_idx on public.inbox_thread_events (thread_id, created_at);

-- =====================================================================================================
-- 8. inbox_folders — per-account folder mirror (denormalizes is_shared/owner so RLS never reads inbox_accounts)
-- =====================================================================================================
create table if not exists public.inbox_folders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  account_id uuid not null references public.inbox_accounts(id) on delete cascade,
  provider_folder_id text not null,
  name text,
  parent_provider_folder_id text,
  system_folder text,                                -- 'inbox'|'sent'|'archive'|'trash'|'drafts' when identifiable
  is_shared boolean not null default true,           -- denormalized from the account
  owner_user_id uuid references auth.users(id) on delete set null,  -- denormalized from the account (personal)
  unread_count integer not null default 0,
  total_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (account_id, provider_folder_id)
);
create index if not exists inbox_folders_account_idx on public.inbox_folders (account_id);

-- =====================================================================================================
-- 9. RLS policies (SELECT only; writes are service-role). Reads go through the cookie-session client so
--    the technician thread-scoped boundary is enforced in the database.
-- =====================================================================================================

-- inbox_threads: personal → owner only; shared → full-access OR assignee OR a member row.
alter table public.inbox_threads enable row level security;
drop policy if exists inbox_threads_select on public.inbox_threads;
create policy inbox_threads_select on public.inbox_threads for select to authenticated
using (
  company_id in (select company_id from public.user_profiles where id = auth.uid())
  and (
    (is_shared = false and owner_user_id = auth.uid())
    or (is_shared = true and (
      exists (select 1 from public.user_profiles up
              where up.id = auth.uid() and (up.role = 'admin' or up.can_access_shared_inbox = true))
      or assigned_to_user_id = auth.uid()
      or exists (select 1 from public.inbox_thread_members m
                 where m.thread_id = inbox_threads.id and m.user_id = auth.uid())
    ))
  )
);

-- inbox_messages: visible iff the parent thread is visible (RLS cascades through the subquery).
alter table public.inbox_messages enable row level security;
drop policy if exists inbox_messages_select on public.inbox_messages;
create policy inbox_messages_select on public.inbox_messages for select to authenticated
using (
  company_id in (select company_id from public.user_profiles where id = auth.uid())
  and exists (select 1 from public.inbox_threads t where t.id = inbox_messages.thread_id)
);

-- inbox_thread_members: a user reads only their OWN membership rows via RLS.
-- (MUST be self-contained — referencing inbox_threads here caused mutual RLS recursion with the
-- inbox_threads policy, which references inbox_thread_members: "infinite recursion detected".
-- Fixed via migration shared_inbox_fix_members_rls_recursion 2026-07-20.) The API lists ALL members
-- of a thread with the service-role admin client after gating access, so full visibility isn't needed here.
alter table public.inbox_thread_members enable row level security;
drop policy if exists inbox_thread_members_select on public.inbox_thread_members;
create policy inbox_thread_members_select on public.inbox_thread_members for select to authenticated
using ( user_id = auth.uid() );

-- inbox_notes: internal — full-access users (managers/office) + the author only (NOT techs).
alter table public.inbox_notes enable row level security;
drop policy if exists inbox_notes_select on public.inbox_notes;
create policy inbox_notes_select on public.inbox_notes for select to authenticated
using (
  company_id in (select company_id from public.user_profiles where id = auth.uid())
  and (
    created_by = auth.uid()
    or exists (select 1 from public.user_profiles up
               where up.id = auth.uid() and (up.role = 'admin' or up.can_access_shared_inbox = true))
  )
);

-- inbox_thread_events: full-access users (audit) + your own actions.
alter table public.inbox_thread_events enable row level security;
drop policy if exists inbox_thread_events_select on public.inbox_thread_events;
create policy inbox_thread_events_select on public.inbox_thread_events for select to authenticated
using (
  company_id in (select company_id from public.user_profiles where id = auth.uid())
  and (
    actor_user_id = auth.uid() or target_user_id = auth.uid()
    or exists (select 1 from public.user_profiles up
               where up.id = auth.uid() and (up.role = 'admin' or up.can_access_shared_inbox = true))
  )
);

-- inbox_folders: shared account folders → full-access users; personal account folders → owner.
alter table public.inbox_folders enable row level security;
drop policy if exists inbox_folders_select on public.inbox_folders;
create policy inbox_folders_select on public.inbox_folders for select to authenticated
using (
  company_id in (select company_id from public.user_profiles where id = auth.uid())
  and (
    (is_shared = false and owner_user_id = auth.uid())
    or (is_shared = true and exists (select 1 from public.user_profiles up
             where up.id = auth.uid() and (up.role = 'admin' or up.can_access_shared_inbox = true)))
  )
);

-- =====================================================================================================
-- 10. Widen get_admin_users(uuid) to return the two new flags (Admin → People roster).
--     Return-type change requires DROP + CREATE; re-revoke anon EXECUTE afterward (SECURITY DEFINER gotcha).
-- =====================================================================================================
drop function if exists public.get_admin_users(uuid);
create function public.get_admin_users(p_company_id uuid)
 returns table(id uuid, email text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, role text, can_access_routing boolean, can_access_lawn boolean, can_access_call_log boolean, can_access_responder boolean, can_access_timesheet boolean, can_access_books boolean, can_access_tracker boolean, can_access_hub boolean, can_access_fleet boolean, can_access_zone_sizer boolean, can_access_dialer boolean, can_access_txt boolean, can_access_unified_inbox boolean, can_post_shout_outs boolean, can_access_marketing boolean, can_admin_marketing boolean, can_access_forms boolean, can_admin_forms boolean, can_admin_products boolean, can_access_daily_log_v2 boolean, can_access_call_log2 boolean, can_access_scoreboards boolean, can_access_files boolean, can_access_pesticide_records boolean, can_access_pricer boolean, can_access_email boolean, can_admin_email boolean, can_manage_drip boolean, can_access_coaching boolean, can_access_beta boolean, can_access_shared_inbox boolean, can_compose_shared_email boolean, can_admin_people boolean, can_admin_hub boolean, can_admin_guardian boolean, can_admin_ai boolean, can_admin_txt boolean, can_admin_announcements boolean, can_admin_file_tags boolean, can_admin_routing boolean, can_admin_timesheet boolean, can_admin_fleet boolean, can_admin_daily_log boolean, can_admin_zone_sizer boolean, can_admin_dialer boolean, can_admin_contacts boolean, can_admin_integrations boolean, dialer_global_ring boolean, display_name text, avatar_url text, invite_sent_at timestamp with time zone, phone text, full_name text, locked_at timestamp with time zone, deactivated_at timestamp with time zone)
 language sql
 security definer
 set search_path to 'public'
as $function$
  SELECT
    up.id, au.email::text, au.created_at, au.last_sign_in_at, up.role,
    up.can_access_routing, up.can_access_lawn, up.can_access_call_log,
    up.can_access_responder, up.can_access_timesheet, up.can_access_books,
    up.can_access_tracker, up.can_access_hub, up.can_access_fleet,
    up.can_access_zone_sizer, up.can_access_dialer, up.can_access_txt,
    up.can_access_unified_inbox,
    up.can_post_shout_outs,
    up.can_access_marketing, up.can_admin_marketing, up.can_access_forms,
    up.can_admin_forms, up.can_admin_products, up.can_access_daily_log_v2,
    up.can_access_call_log2, up.can_access_scoreboards,
    up.can_access_files, up.can_access_pesticide_records,
    up.can_access_pricer,
    up.can_access_email, up.can_admin_email,
    up.can_manage_drip,
    up.can_access_coaching,
    up.can_access_beta,
    up.can_access_shared_inbox, up.can_compose_shared_email,
    up.can_admin_people, up.can_admin_hub,
    up.can_admin_guardian, up.can_admin_ai, up.can_admin_txt, up.can_admin_announcements, up.can_admin_file_tags,
    up.can_admin_routing, up.can_admin_timesheet, up.can_admin_fleet, up.can_admin_daily_log,
    up.can_admin_zone_sizer, up.can_admin_dialer, up.can_admin_contacts,
    up.can_admin_integrations,
    up.dialer_global_ring, hu.display_name, hu.avatar_url,
    up.invite_sent_at, up.phone, up.full_name,
    up.locked_at, up.deactivated_at
  FROM public.user_profiles up
  JOIN auth.users au ON au.id = up.id
  LEFT JOIN public.hub_users hu ON hu.id = up.id
  WHERE up.company_id = p_company_id
$function$;

revoke all on function public.get_admin_users(uuid) from public;
revoke all on function public.get_admin_users(uuid) from anon;
grant execute on function public.get_admin_users(uuid) to authenticated;
grant execute on function public.get_admin_users(uuid) to service_role;
