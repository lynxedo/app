-- Admin → AI area: consolidate the AI admin surfaces (Guardian, Auto Responder,
-- AI Receptionist, Knowledge) behind one new permission gate `can_admin_ai`.
--
-- APPLIED to the shared DB on 2026-07-10 via Supabase MCP (migration
-- `add_can_admin_ai_area`). This file is the repo record.
--
-- Additive + a safe grandfather UPDATE (grants access only to people who already
-- had the equivalent Guardian/Dialer admin). The get_admin_users() recreate keeps
-- the exact prior ACL (authenticated + service_role; NEVER anon — it exposes every
-- user's email + permissions).

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS can_admin_ai boolean NOT NULL DEFAULT false;

-- Grandfather: anyone who can administer Guardian or the Dialer AI panels today
-- keeps access to the consolidated AI admin area.
UPDATE public.user_profiles
  SET can_admin_ai = true
  WHERE can_admin_guardian OR can_admin_dialer;

-- Widen get_admin_users() to expose can_admin_ai (RETURNS TABLE change needs
-- DROP + CREATE). The function body + ACL are otherwise identical to before;
-- can_admin_ai is inserted right after can_admin_guardian in both the RETURNS
-- TABLE signature and the SELECT list. Re-grant is mandatory after DROP+CREATE
-- because Supabase re-grants anon EXECUTE by default on recreate.
DROP FUNCTION IF EXISTS public.get_admin_users();
CREATE FUNCTION public.get_admin_users()
 RETURNS TABLE(id uuid, email text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, role text, can_access_routing boolean, can_access_lawn boolean, can_access_call_log boolean, can_access_responder boolean, can_access_timesheet boolean, can_access_books boolean, can_access_tracker boolean, can_access_hub boolean, can_access_fleet boolean, can_access_zone_sizer boolean, can_access_dialer boolean, can_access_txt boolean, can_access_unified_inbox boolean, can_post_shout_outs boolean, can_access_marketing boolean, can_admin_marketing boolean, can_access_forms boolean, can_admin_forms boolean, can_admin_products boolean, can_access_daily_log_v2 boolean, can_access_call_log2 boolean, can_access_scoreboards boolean, can_access_files boolean, can_access_pesticide_records boolean, can_access_pricer boolean, can_access_email boolean, can_admin_email boolean, can_access_coaching boolean, can_access_beta boolean, can_admin_people boolean, can_admin_hub boolean, can_admin_guardian boolean, can_admin_ai boolean, can_admin_txt boolean, can_admin_announcements boolean, can_admin_file_tags boolean, can_admin_routing boolean, can_admin_timesheet boolean, can_admin_fleet boolean, can_admin_daily_log boolean, can_admin_zone_sizer boolean, can_admin_dialer boolean, can_admin_contacts boolean, dialer_global_ring boolean, display_name text, avatar_url text, invite_sent_at timestamp with time zone, phone text, full_name text, locked_at timestamp with time zone, deactivated_at timestamp with time zone)
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
    up.can_admin_guardian, up.can_admin_ai, up.can_admin_txt, up.can_admin_announcements, up.can_admin_file_tags,
    up.can_admin_routing, up.can_admin_timesheet, up.can_admin_fleet, up.can_admin_daily_log,
    up.can_admin_zone_sizer, up.can_admin_dialer, up.can_admin_contacts,
    up.dialer_global_ring, hu.display_name, hu.avatar_url,
    up.invite_sent_at, up.phone, up.full_name,
    up.locked_at, up.deactivated_at
  FROM public.user_profiles up
  JOIN auth.users au ON au.id = up.id
  LEFT JOIN public.hub_users hu ON hu.id = up.id
$function$;

REVOKE ALL ON FUNCTION public.get_admin_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_users() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_users() TO service_role;
