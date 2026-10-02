-- Work Orders — emoji reactions on a stop's notes ("updates"), Oct 2, 2026.
-- Ben: "Add an emoji reaction picker to updates." Mirrors Daily Log v1's
-- daily_log_update_reactions, keyed on the v2 stop message.
--
-- ADDITIVE. Applied via Supabase MCP apply_migration
-- `work_orders_stop_message_reactions_2026_10_02`.

create table if not exists public.daily_log_stop_message_reactions (
  message_id uuid not null references public.daily_log_stop_messages(id) on delete cascade,
  user_id uuid not null references public.hub_users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists daily_log_stop_message_reactions_message_idx
  on public.daily_log_stop_message_reactions (message_id);

alter table public.daily_log_stop_message_reactions enable row level security;

-- Reads: anyone in the message's company (the message row carries company_id).
-- Writes go through the admin client in the toggle route, which verifies the
-- stop belongs to the caller's company and only ever writes the caller's own row.
drop policy if exists dl_stop_message_reactions_select on public.daily_log_stop_message_reactions;
create policy dl_stop_message_reactions_select on public.daily_log_stop_message_reactions
  for select to authenticated
  using (
    exists (
      select 1 from public.daily_log_stop_messages m
      where m.id = message_id
        and m.company_id in (select company_id from public.user_profiles where id = auth.uid())
    )
  );
