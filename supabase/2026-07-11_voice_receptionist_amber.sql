-- 2026-07-11_voice_receptionist_amber.sql
-- AI Voice Receptionist v0.5 (Ben, July 11 2026) — persona name, two
-- context-aware greetings, and the auto recap-text opt-in.
--
-- Additive + non-destructive. Existing rows keep working: every new text column
-- defaults to NULL (→ the code default in lib/voice-receptionist.ts), and
-- recap_text_enabled defaults TRUE so the receptionist offers the recap text
-- (the send itself is still gated by VOICE_TEST_MODE + the caller's spoken
-- opt-in). The legacy single `greeting` column is kept as an after-hours
-- fallback so nothing a company already customized is lost.

alter table public.voice_receptionist_settings
  add column if not exists receptionist_name        text,   -- null/blank -> 'Amber' (code default)
  add column if not exists greeting_business_hours   text,   -- null/blank -> buildWelcomeGreeting(business_hours)
  add column if not exists greeting_after_hours      text,   -- null/blank -> greeting (legacy) -> buildWelcomeGreeting(after_hours)
  add column if not exists recap_text_enabled        boolean not null default true;
