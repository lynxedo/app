-- Email Marketing Session 3.5: rich block composer.
-- Applied to the shared Supabase DB on 2026-06-23 via MCP. Additive.
-- `design` holds the ordered blocks + global settings the composer edits;
-- email_templates.body_html stays as the rendered email-safe output used at send time.
alter table public.email_templates
  add column if not exists design jsonb not null default '{}'::jsonb;
