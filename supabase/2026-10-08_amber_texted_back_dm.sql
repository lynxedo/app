-- Oct 8 2026 — per-person switch for the assistant's "texted back" DM
-- (lib/amber-text.ts routeInboundToTodaysTeammate). Default TRUE = today's behaviour:
-- the thread is assigned to the teammate either way; this only controls the extra DM.
-- Applied to the live DB Oct 8 2026 (before the code deployed).
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS amber_texted_back_dm boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.user_profiles.amber_texted_back_dm IS
  'Settings → Notifications: DM me from the assistant when a customer texts back after my conversation earlier today. The thread is assigned to me either way; false only skips the DM.';
NOTIFY pgrst, 'reload schema';
