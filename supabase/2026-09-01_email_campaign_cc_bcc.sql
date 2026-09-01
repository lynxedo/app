-- 2026-09-01: per-campaign CC/BCC copy addresses.
-- Each address listed here receives a copy of EVERY email the campaign sends
-- (riding on each recipient's own email via Resend's cc/bcc fields).
-- Additive only — no existing data touched. Applied to the shared DB via MCP.

alter table public.email_campaigns
  add column if not exists cc_emails text[] not null default '{}',
  add column if not exists bcc_emails text[] not null default '{}';
