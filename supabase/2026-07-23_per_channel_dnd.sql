-- Per-channel DND — add Txt + Inbox DND (mirroring hub_dnd_*), so DND is now
-- Master / Hub / Txt / Inbox / Calls, each with an optional scheduled window.
-- APPLIED to the shared DB via Supabase MCP `per_channel_dnd_2026_07_23`. Additive.

alter table public.user_profiles add column if not exists txt_dnd_enabled   boolean not null default false;
alter table public.user_profiles add column if not exists txt_dnd_schedule   jsonb;
alter table public.user_profiles add column if not exists inbox_dnd_enabled boolean not null default false;
alter table public.user_profiles add column if not exists inbox_dnd_schedule jsonb;

-- Carry-over (behavior-preserving): TODAY the push gate applies Hub DND to EVERY push, so
-- Hub DND currently silences Txt + Inbox too. Splitting them into independent channels would
-- suddenly un-silence Txt/Inbox for anyone relying on Hub DND — so seed the two new channels
-- from each user's current Hub DND setting. One-time; only writes the brand-new columns.
update public.user_profiles
  set txt_dnd_enabled   = hub_dnd_enabled,
      txt_dnd_schedule   = hub_dnd_schedule,
      inbox_dnd_enabled = hub_dnd_enabled,
      inbox_dnd_schedule = hub_dnd_schedule
  where hub_dnd_enabled = true or hub_dnd_schedule is not null;
