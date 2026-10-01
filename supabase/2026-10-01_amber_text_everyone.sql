-- Amber replies to texts (Oct 1 2026): widen Amber-over-text from drip replies
-- to every unclaimed one-on-one thread. Additive only. Applied to the shared DB
-- as migration amber_text_everyone_2026_10_01.
alter table public.voice_receptionist_settings
  add column if not exists text_head_start_enabled boolean default false,   -- wait for a teammate first, in business hours
  add column if not exists text_head_start_minutes smallint default 3;

alter table public.amber_text_threads
  add column if not exists handoff_reason  text,          -- why Amber handed the thread to a human
  add column if not exists handoff_summary text,          -- her one-paragraph summary for the office
  add column if not exists handed_off_at   timestamptz;
