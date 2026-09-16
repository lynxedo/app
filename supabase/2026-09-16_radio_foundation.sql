-- Radio — press-and-hold voice in 1-on-1 Hub DMs — foundation (Phase 1, Session A).
-- Design: Hub/HUB_RADIO_PRD.md. Additive only: one user_profiles flag, three tables,
-- get_admin_users widened to return the flag. Staging and prod share this database;
-- nothing reads these objects until the Radio routes ship, so order of deploy is free.

-- 1. Permission flag ---------------------------------------------------------
alter table public.user_profiles
  add column if not exists can_access_radio boolean not null default false;

-- 2. Tables ------------------------------------------------------------------
-- A session is one accepted channel between two people in one DM. It is "active"
-- when status = 'active' and last_activity_at is under an hour old — computed on
-- read, no sweeper; every transmission bumps last_activity_at.
create table if not exists public.radio_sessions (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  initiator_id     uuid not null references auth.users(id) on delete cascade,
  recipient_id     uuid not null references auth.users(id) on delete cascade,
  status           text not null default 'pending'
                   check (status in ('pending','active','declined','closed','expired')),
  created_at       timestamptz not null default now(),
  accepted_at      timestamptz,
  last_activity_at timestamptz not null default now(),
  closed_at        timestamptz,
  closed_by        uuid references auth.users(id) on delete set null,
  constraint radio_sessions_two_people check (initiator_id <> recipient_id)
);
create index if not exists radio_sessions_conversation_idx
  on public.radio_sessions (conversation_id, created_at desc);
-- "Is there a channel waiting for me / open with me right now?" — the hot read.
create index if not exists radio_sessions_open_idx
  on public.radio_sessions (recipient_id, status)
  where status in ('pending','active');

-- One press-and-hold. ended_at + piece_count arrive with the end marker; a row
-- with ended_at null is either still being spoken or was abandoned mid-hold.
create table if not exists public.radio_transmissions (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.radio_sessions(id) on delete cascade,
  sender_id    uuid not null references auth.users(id) on delete cascade,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  piece_count  integer,
  duration_ms  integer
);
create index if not exists radio_transmissions_session_idx
  on public.radio_transmissions (session_id, started_at);

-- One self-contained audio file, played strictly in seq order by the receiver.
create table if not exists public.radio_pieces (
  id               uuid primary key default gen_random_uuid(),
  transmission_id  uuid not null references public.radio_transmissions(id) on delete cascade,
  seq              integer not null check (seq >= 1),
  r2_key           text not null,
  mime             text not null,
  duration_ms      integer,
  bytes            integer,
  created_at       timestamptz not null default now(),
  unique (transmission_id, seq)
);

-- 3. RLS — in the first migration, not after -------------------------------
-- These tables hold recordings of people talking. Supabase's default privileges
-- grant a new public table to anon and authenticated, so without this block the
-- rows are readable through PostgREST by anyone with the URL. Policy: a session is
-- visible only to its initiator or recipient; transmissions and pieces inherit
-- through the session. Every WRITE goes through the API routes as service_role,
-- so authenticated gets SELECT and nothing else.
alter table public.radio_sessions      enable row level security;
alter table public.radio_transmissions enable row level security;
alter table public.radio_pieces        enable row level security;

-- ⚠ Revoke from authenticated TOO, not just anon. Supabase's default privileges
-- already grant ALL on a new public table to authenticated, so a bare `grant select`
-- only adds to that and leaves INSERT/UPDATE/DELETE/TRUNCATE in place. RLS covers the
-- first three (no write policy exists, so they touch zero rows) but TRUNCATE is NOT
-- subject to row-level security — the privilege by itself empties the table.
revoke all on public.radio_sessions, public.radio_transmissions, public.radio_pieces from anon, public, authenticated;
grant select on public.radio_sessions, public.radio_transmissions, public.radio_pieces to authenticated;
grant all    on public.radio_sessions, public.radio_transmissions, public.radio_pieces to service_role;

drop policy if exists radio_sessions_select_participant on public.radio_sessions;
create policy radio_sessions_select_participant on public.radio_sessions
  for select to authenticated
  using (initiator_id = (select auth.uid()) or recipient_id = (select auth.uid()));

drop policy if exists radio_transmissions_select_participant on public.radio_transmissions;
create policy radio_transmissions_select_participant on public.radio_transmissions
  for select to authenticated
  using (exists (
    select 1 from public.radio_sessions s
    where s.id = radio_transmissions.session_id
      and (s.initiator_id = (select auth.uid()) or s.recipient_id = (select auth.uid()))
  ));

drop policy if exists radio_pieces_select_participant on public.radio_pieces;
create policy radio_pieces_select_participant on public.radio_pieces
  for select to authenticated
  using (exists (
    select 1
    from public.radio_transmissions t
    join public.radio_sessions s on s.id = t.session_id
    where t.id = radio_pieces.transmission_id
      and (s.initiator_id = (select auth.uid()) or s.recipient_id = (select auth.uid()))
  ));

-- 4. get_admin_users returns the new flag -----------------------------------
-- Return-type change → DROP + CREATE (the July 22 pattern). The body below is the
-- LIVE definition read from the catalog on Sep 16 2026 with one column appended
-- at the end — NOT the last migration file, which was already two columns behind
-- (can_access_irrigation, can_access_reports). A wrong column list here breaks
-- Admin → People for every tenant, so the live catalog is the only safe source.
-- SECURITY DEFINER re-grants EXECUTE to public on create → re-revoke afterwards.
drop function if exists public.get_admin_users(uuid);
create or replace function public.get_admin_users(p_company_id uuid)
 returns table(id uuid, email text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, role text, can_access_routing boolean, can_access_lawn boolean, can_access_call_log boolean, can_access_responder boolean, can_access_timesheet boolean, can_access_books boolean, can_access_tracker boolean, can_access_hub boolean, can_access_fleet boolean, can_access_zone_sizer boolean, can_access_dialer boolean, can_access_txt boolean, can_access_unified_inbox boolean, can_post_shout_outs boolean, can_access_marketing boolean, can_admin_marketing boolean, can_access_forms boolean, can_admin_forms boolean, can_admin_products boolean, can_access_daily_log_v2 boolean, can_access_call_log2 boolean, can_access_scoreboards boolean, can_access_files boolean, can_access_pesticide_records boolean, can_access_pricer boolean, can_access_email boolean, can_admin_email boolean, can_manage_drip boolean, can_access_coaching boolean, can_access_beta boolean, can_access_shared_inbox boolean, can_compose_shared_email boolean, can_manage_shared_inbox boolean, can_access_irrigation boolean, can_admin_people boolean, can_admin_hub boolean, can_admin_guardian boolean, can_admin_ai boolean, can_admin_txt boolean, can_admin_announcements boolean, can_admin_file_tags boolean, can_admin_routing boolean, can_admin_timesheet boolean, can_admin_fleet boolean, can_admin_daily_log boolean, can_admin_zone_sizer boolean, can_admin_dialer boolean, can_admin_contacts boolean, can_admin_integrations boolean, dialer_global_ring boolean, display_name text, avatar_url text, invite_sent_at timestamp with time zone, phone text, full_name text, locked_at timestamp with time zone, deactivated_at timestamp with time zone, can_access_reports boolean, can_access_radio boolean)
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
    up.can_access_shared_inbox, up.can_compose_shared_email, up.can_manage_shared_inbox,
    up.can_access_irrigation,
    up.can_admin_people, up.can_admin_hub,
    up.can_admin_guardian, up.can_admin_ai, up.can_admin_txt, up.can_admin_announcements, up.can_admin_file_tags,
    up.can_admin_routing, up.can_admin_timesheet, up.can_admin_fleet, up.can_admin_daily_log,
    up.can_admin_zone_sizer, up.can_admin_dialer, up.can_admin_contacts,
    up.can_admin_integrations,
    up.dialer_global_ring, hu.display_name, hu.avatar_url,
    up.invite_sent_at, up.phone, up.full_name,
    up.locked_at, up.deactivated_at,
    up.can_access_reports,
    up.can_access_radio
  FROM public.user_profiles up
  JOIN auth.users au ON au.id = up.id
  LEFT JOIN public.hub_users hu ON hu.id = up.id
  WHERE up.company_id = p_company_id
$function$;
revoke all on function public.get_admin_users(uuid) from public;
revoke all on function public.get_admin_users(uuid) from anon;
grant execute on function public.get_admin_users(uuid) to authenticated;
grant execute on function public.get_admin_users(uuid) to service_role;
