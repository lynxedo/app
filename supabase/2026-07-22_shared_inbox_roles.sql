-- Shared Inbox redesign (Step 1) — role split (Manager vs Standard user),
-- closed-by tracking, and folder visibility.
-- APPLIED to the shared staging+prod DB via Supabase MCP apply_migration `shared_inbox_roles_2026_07_22`.
--
-- ADDITIVE only: three column adds + four SELECT-policy swaps. No data is deleted or restructured.
-- The feature is dark on prod (nobody holds these flags, no code reads these tables there), so the
-- policy swaps are inert on prod and only change staging behavior.
--
-- Role model (PRD Redesign 2026-07-22):
--   • can_access_shared_inbox  = STANDARD USER  — may open the inbox; sees ONLY threads assigned/shared to them.
--   • can_manage_shared_inbox  = MANAGER        — sees All + the unassigned Queue; can claim/assign/close/share.
--   • role = 'admin'           ⇒ automatically a Manager.
-- The RLS "sees-everything" clause therefore repoints from can_access_shared_inbox → can_manage_shared_inbox.

-- =====================================================================================================
-- 1. Manager flag on user_profiles (separate from the plain access flag).
-- =====================================================================================================
alter table public.user_profiles
  add column if not exists can_manage_shared_inbox boolean not null default false;

-- =====================================================================================================
-- 2. Who closed a thread — Standard users' "Closed" tab shows only the ones they closed.
-- =====================================================================================================
alter table public.inbox_threads
  add column if not exists closed_by_user_id uuid references auth.users(id) on delete set null;

-- =====================================================================================================
-- 3. Admin-hidden folders — still synced, just dropped from the folder picker.
-- =====================================================================================================
alter table public.inbox_folders
  add column if not exists hidden boolean not null default false;

-- =====================================================================================================
-- 4. RLS: repoint the manager ("sees everything") clause to can_manage_shared_inbox.
--    A plain-access Standard user now falls to assignee/member visibility only.
-- =====================================================================================================

-- inbox_threads: personal → owner only; shared → MANAGER OR assignee OR a member row.
drop policy if exists inbox_threads_select on public.inbox_threads;
create policy inbox_threads_select on public.inbox_threads for select to authenticated
using (
  company_id in (select company_id from public.user_profiles where id = auth.uid())
  and (
    (is_shared = false and owner_user_id = auth.uid())
    or (is_shared = true and (
      exists (select 1 from public.user_profiles up
              where up.id = auth.uid() and (up.role = 'admin' or up.can_manage_shared_inbox = true))
      or assigned_to_user_id = auth.uid()
      or exists (select 1 from public.inbox_thread_members m
                 where m.thread_id = inbox_threads.id and m.user_id = auth.uid())
    ))
  )
);

-- inbox_notes: internal — managers + the note author only.
drop policy if exists inbox_notes_select on public.inbox_notes;
create policy inbox_notes_select on public.inbox_notes for select to authenticated
using (
  company_id in (select company_id from public.user_profiles where id = auth.uid())
  and (
    created_by = auth.uid()
    or exists (select 1 from public.user_profiles up
               where up.id = auth.uid() and (up.role = 'admin' or up.can_manage_shared_inbox = true))
  )
);

-- inbox_thread_events: managers (audit) + your own actions.
drop policy if exists inbox_thread_events_select on public.inbox_thread_events;
create policy inbox_thread_events_select on public.inbox_thread_events for select to authenticated
using (
  company_id in (select company_id from public.user_profiles where id = auth.uid())
  and (
    actor_user_id = auth.uid() or target_user_id = auth.uid()
    or exists (select 1 from public.user_profiles up
               where up.id = auth.uid() and (up.role = 'admin' or up.can_manage_shared_inbox = true))
  )
);

-- inbox_folders: shared account folders → managers; personal account folders → owner.
drop policy if exists inbox_folders_select on public.inbox_folders;
create policy inbox_folders_select on public.inbox_folders for select to authenticated
using (
  company_id in (select company_id from public.user_profiles where id = auth.uid())
  and (
    (is_shared = false and owner_user_id = auth.uid())
    or (is_shared = true and exists (select 1 from public.user_profiles up
             where up.id = auth.uid() and (up.role = 'admin' or up.can_manage_shared_inbox = true)))
  )
);
