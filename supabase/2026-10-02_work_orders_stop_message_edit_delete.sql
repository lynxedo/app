-- Work Orders: edit + delete a stop note (Ben, Oct 2 2026).
-- Additive only. A delete is soft (deleted_at) — the note is hidden, never erased.
-- edited_at is separate from updated_at so "(edited)" shows only for a real edit.
alter table public.daily_log_stop_messages
  add column if not exists edited_at  timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;
