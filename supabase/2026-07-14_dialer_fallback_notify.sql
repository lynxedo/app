-- Fallback voicemail notification settings (Jul 14 2026). Applied to the
-- shared DB via Supabase MCP the same day (migration name:
-- dialer_fallback_notify_settings).
--
-- When the Twilio-hosted emergency fallback (Serverless service
-- lynxedo-voice-fallback) records a voicemail because the main call flow
-- errored, POST /api/voice/fallback-notify delivers alerts per these settings.
--   method: 'hub' (Guardian DM + push, default) | 'sms' | 'both'
--   user_ids: hub recipients; empty = fall back to voicemail_recipient_user_ids
--   sms_numbers: E164 targets used when method includes sms
ALTER TABLE dialer_settings
  ADD COLUMN IF NOT EXISTS fallback_notify_method text NOT NULL DEFAULT 'hub',
  ADD COLUMN IF NOT EXISTS fallback_notify_user_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS fallback_notify_sms_numbers text[] NOT NULL DEFAULT '{}';
