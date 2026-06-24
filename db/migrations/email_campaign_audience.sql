-- Email campaigns: remember a campaign's audience picks.
-- Applied to the shared Supabase DB via MCP (migration `email_campaign_audience`).
-- Recorded here for repo traceability. Additive nullable column only.
--
-- A campaign can now combine multiple segments + hand-picked contacts + typed-in
-- addresses, all de-duplicated by email at send time. We persist the SPEC (not the
-- resolved list) so a DRAFT round-trips for later editing, and the audience is
-- re-resolved fresh when the draft is finally sent. Shape (see lib/email-campaigns
-- AudienceSpec): { everyone?, segment_ids?[], contact_ids?[], extra_emails?[], excluded_ids?[] }.
--
-- status already allows 'draft' (no CHECK constraint); design jsonb already exists
-- (Session 7.4); email_campaign_recipients.contact_id is already nullable (so a
-- typed-in non-contact address fits with contact_id = null). No other change needed.

alter table public.email_campaigns add column if not exists audience jsonb;
