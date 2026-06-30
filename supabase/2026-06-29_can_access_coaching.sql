-- Phase 3 of the call-coaching feature: a dedicated permission to view coaching
-- (rep-performance) scores, separate from call-log/transcript access so coaching
-- stays manager-only. Applied to the shared Supabase DB on 2026-06-29 via MCP.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS can_access_coaching boolean NOT NULL DEFAULT false;
