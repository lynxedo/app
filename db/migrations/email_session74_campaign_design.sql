-- Email Session 7.4 (Compose flow) — a campaign carries its own editable design.
-- Applied to the shared Supabase DB via MCP (migration `email_session74_campaign_design`).
-- Recorded here for repo traceability. Additive nullable column only.
--
-- The campaign compose flow seeds the block editor from a template, the user
-- customizes the email for THAT campaign, and we snapshot the result. body_html
-- stays the rendered send-time output; design holds the block JSON so a draft
-- campaign can be reopened/edited later without re-deriving it from HTML.

alter table public.email_campaigns add column if not exists design jsonb;
