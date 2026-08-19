-- Per-person notification settings for a Hub Board.
--
-- Lives on the board itself (the bell in the board header), NOT in Settings or
-- Admin: everyone on a board picks their own, and one person's choice never
-- affects anybody else's.
--
-- The column DEFAULTS deliberately reproduce today's behaviour exactly, so a
-- board with no rows here behaves byte-identically to before this shipped:
--   new_tasks 'all'  — every board member already got a push for a new task
--   replies   'off'  — nothing notified on a note except an @mention
--   files     'off'  — nothing notified at all when a file was attached
--   due       'mine' — the overdue cron already DM'd assignees only
--
-- 'all'  = every task on the board
-- 'mine' = only tasks I'm on (assignee, or I created it / replied to it)
-- 'off'  = never
--
-- @mentions are deliberately NOT listed: being named is a direct address and
-- always notifies, the same rule rooms and DMs follow.
create table if not exists public.board_notification_prefs (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards(id)     on delete cascade,
  user_id    uuid not null references public.hub_users(id)  on delete cascade,
  new_tasks  text not null default 'all'  check (new_tasks in ('all', 'mine', 'off')),
  replies    text not null default 'off'  check (replies   in ('all', 'mine', 'off')),
  files      text not null default 'off'  check (files     in ('all', 'mine', 'off')),
  due        text not null default 'mine' check (due       in ('all', 'mine', 'off')),
  updated_at timestamptz not null default now(),
  unique (board_id, user_id)
);

create index if not exists board_notification_prefs_board_idx
  on public.board_notification_prefs (board_id);

alter table public.board_notification_prefs enable row level security;

-- Own-row only — your settings are yours. Mirrors notification_prefs_all.
-- FOR ALL with no WITH CHECK reuses the USING expression on INSERT/UPDATE.
--
-- ⚠ This policy does NOT constrain board_id, so a determined caller could in
-- principle stash a row against a board they cannot see. That grants nothing:
-- lib/board-notify.ts re-checks visibility against the board's own audience
-- before anyone is added to a recipient list, and the API route below refuses
-- a board outside the caller's company. The visibility re-check is the gate.
drop policy if exists board_notification_prefs_all on public.board_notification_prefs;
create policy board_notification_prefs_all
  on public.board_notification_prefs as permissive for all to public
  using (user_id = (select auth.uid()));

-- Marks the one-time "due today" heads-up, exactly as overdue_notified_at marks
-- the one-time overdue alert. Changing a task's due date/time clears both, so a
-- rescheduled task is announced again for its new deadline.
alter table public.board_items add column if not exists due_notified_at timestamptz;
