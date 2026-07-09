-- Beta Feature Flags — foundation (additive; nothing destructive).
-- Applied to the shared Supabase DB on 2026-07-09 via the Supabase MCP.
--
-- Adds a "beta" release ring between staging-alpha and everyone-stable: features
-- ship to prod behind a flag, dark until a user opts in. Two-layer gate —
-- admin availability (beta_features.is_available) AND user opt-in
-- (user_beta_optins) — plus a per-user eligibility flag (can_access_beta).

-- 1) Per-user beta eligibility (the Admin → People toggle). Mirrors every other
--    can_access_* flag: boolean NOT NULL DEFAULT false.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS can_access_beta boolean NOT NULL DEFAULT false;

-- 2) Registry of beta features (admin availability layer).
CREATE TABLE IF NOT EXISTS public.beta_features (
  key             text PRIMARY KEY,             -- stable slug referenced in code, e.g. conversation_popout
  label           text NOT NULL,
  description     text NOT NULL DEFAULT '',
  screenshot_url  text,                          -- R2 storage_path (served via /api/hub/beta/screenshot)
  is_available    boolean NOT NULL DEFAULT true, -- admin kill-switch: false = force-off for everyone
  default_on      boolean NOT NULL DEFAULT false,-- graduation step: treated as ON unless user opted out
  requires_permission text,                      -- optional extra gate (future); null = none
  company_id      uuid,                          -- null = platform-wide; set = tenant-scoped (SaaS-safe)
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  retired_at      timestamptz                    -- set when a flag graduates/retires (cleanup marker)
);
ALTER TABLE public.beta_features ENABLE ROW LEVEL SECURITY;
-- Read: authenticated users see platform-wide betas + their own company's.
-- Scoped TO authenticated (not public) so a NULL-company row is never anon-readable.
DROP POLICY IF EXISTS beta_features_select ON public.beta_features;
CREATE POLICY beta_features_select ON public.beta_features
  FOR SELECT TO authenticated
  USING (
    company_id IS NULL
    OR company_id IN (SELECT up.company_id FROM public.user_profiles up WHERE up.id = auth.uid())
  );
-- Writes are admin-only via the service-role admin client (bypasses RLS) — no write policy.

-- 3) Per-user opt-ins (user layer). One row per (user, feature) the user toggled.
CREATE TABLE IF NOT EXISTS public.user_beta_optins (
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_key  text NOT NULL REFERENCES public.beta_features(key) ON DELETE CASCADE,
  enabled      boolean NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature_key)
);
ALTER TABLE public.user_beta_optins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_beta_optins_owner_select ON public.user_beta_optins;
CREATE POLICY user_beta_optins_owner_select ON public.user_beta_optins
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS user_beta_optins_owner_insert ON public.user_beta_optins;
CREATE POLICY user_beta_optins_owner_insert ON public.user_beta_optins
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS user_beta_optins_owner_update ON public.user_beta_optins;
CREATE POLICY user_beta_optins_owner_update ON public.user_beta_optins
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS user_beta_optins_owner_delete ON public.user_beta_optins;
CREATE POLICY user_beta_optins_owner_delete ON public.user_beta_optins
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 4) Widen get_admin_users() to expose can_access_beta so the People panel can
--    read/toggle it. Return-type change requires DROP+CREATE (not OR REPLACE).
--    ⚠ Recreating a SECURITY DEFINER function re-grants EXECUTE to anon via
--    Supabase default privileges (lesson_security_definer_anon_grant) — this
--    function returns every user's email + permissions, so anon MUST be revoked.
--    Final grants reproduce the original: authenticated + service_role only.
DROP FUNCTION IF EXISTS public.get_admin_users();
CREATE FUNCTION public.get_admin_users()
 RETURNS TABLE(id uuid, email text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, role text, can_access_routing boolean, can_access_lawn boolean, can_access_call_log boolean, can_access_responder boolean, can_access_timesheet boolean, can_access_books boolean, can_access_tracker boolean, can_access_hub boolean, can_access_fleet boolean, can_access_zone_sizer boolean, can_access_dialer boolean, can_access_txt boolean, can_access_unified_inbox boolean, can_post_shout_outs boolean, can_access_marketing boolean, can_admin_marketing boolean, can_access_forms boolean, can_admin_forms boolean, can_admin_products boolean, can_access_daily_log_v2 boolean, can_access_call_log2 boolean, can_access_scoreboards boolean, can_access_files boolean, can_access_pesticide_records boolean, can_access_pricer boolean, can_access_email boolean, can_admin_email boolean, can_access_coaching boolean, can_access_beta boolean, can_admin_people boolean, can_admin_hub boolean, can_admin_guardian boolean, can_admin_txt boolean, can_admin_announcements boolean, can_admin_file_tags boolean, can_admin_routing boolean, can_admin_timesheet boolean, can_admin_fleet boolean, can_admin_daily_log boolean, can_admin_zone_sizer boolean, can_admin_dialer boolean, can_admin_contacts boolean, dialer_global_ring boolean, display_name text, avatar_url text, invite_sent_at timestamp with time zone, phone text, full_name text, locked_at timestamp with time zone, deactivated_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    up.id, au.email::text, au.created_at, au.last_sign_in_at, up.role,
    up.can_access_routing, up.can_access_lawn, up.can_access_call_log,
    up.can_access_responder, up.can_access_timesheet, up.can_access_books,
    up.can_access_tracker, up.can_access_hub, up.can_access_fleet,
    up.can_access_zone_sizer, up.can_access_dialer, up.can_access_txt,
    up.can_access_unified_inbox,
    up.can_post_shout_outs,
    up.can_access_marketing, up.can_admin_marketing, up.can_access_forms,
    up.can_admin_forms, up.can_admin_products, up.can_access_daily_log_v2,
    up.can_access_call_log2, up.can_access_scoreboards,
    up.can_access_files, up.can_access_pesticide_records,
    up.can_access_pricer,
    up.can_access_email, up.can_admin_email,
    up.can_access_coaching,
    up.can_access_beta,
    up.can_admin_people, up.can_admin_hub,
    up.can_admin_guardian, up.can_admin_txt, up.can_admin_announcements, up.can_admin_file_tags,
    up.can_admin_routing, up.can_admin_timesheet, up.can_admin_fleet, up.can_admin_daily_log,
    up.can_admin_zone_sizer, up.can_admin_dialer, up.can_admin_contacts,
    up.dialer_global_ring, hu.display_name, hu.avatar_url,
    up.invite_sent_at, up.phone, up.full_name,
    up.locked_at, up.deactivated_at
  FROM public.user_profiles up
  JOIN auth.users au ON au.id = up.id
  LEFT JOIN public.hub_users hu ON hu.id = up.id
$function$;
REVOKE ALL ON FUNCTION public.get_admin_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_users() TO authenticated, service_role;

-- 5) Seed the first beta feature — the conversation pop-out (built on develop,
--    shipping to the Beta ring). is_available=true so opted-in users can try it;
--    default_on=false so it's opt-in only. Platform-wide (company_id null).
INSERT INTO public.beta_features (key, label, description, is_available, default_on, company_id, sort_order)
VALUES (
  'conversation_popout',
  'Pop-out conversations',
  'Float a Txt or Hub chat thread in its own always-on-top window so you can keep reading and replying while you work in another app or on a different Hub page. Works in Chrome and Edge on desktop.',
  true, false, NULL, 0
)
ON CONFLICT (key) DO NOTHING;
