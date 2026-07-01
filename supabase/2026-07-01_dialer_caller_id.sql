-- Dialer caller-ID (Twilio CNAM) fallback cache.
--
-- When an inbound number matches NONE of our own data (no saved contact name,
-- no Jobber client / contact-person), the Dialer falls back to Twilio's carrier
-- "caller ID" name as a last resort (lib/dialer-lookup.ts + lib/twilio-caller-id.ts).
--
-- That name is the carrier's guess — it can be a spouse / line-holder / stale —
-- so it is stored SEPARATELY from `name`, shown clearly labeled, and must NEVER
-- overwrite a real saved name. `caller_id_checked_at` lets us avoid re-paying
-- Twilio for the same number (including numbers that come back blank) within a TTL.
--
-- Additive only. Safe to run on the shared staging+prod database.
alter table txt_contacts
  add column if not exists caller_id_name text,
  add column if not exists caller_id_checked_at timestamptz;
