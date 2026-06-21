-- Session 5 (Pricer) — can_access_pricer permission flag + get_admin_users RPC refresh.
-- Applied to the shared Supabase DB on 2026-06-19 via MCP (migration
-- `session5_pricer_access_flag`). Recorded here for repo traceability.
--
-- Gates the staff quoting tool at /hub/pricer. Default false (locked; grant per
-- user in Admin → People). Admins always have access in code (page guard ORs isAdmin).
-- get_admin_users is RETURNS TABLE, so it must be DROP + CREATE (cannot widen the
-- signature via CREATE OR REPLACE); recreating resets the ACL to PUBLIC, so we
-- REVOKE FROM public, anon and GRANT only to authenticated afterward.

alter table public.user_profiles
  add column if not exists can_access_pricer boolean not null default false;

drop function if exists public.get_admin_users();

create function public.get_admin_users()
 returns table(id uuid, email text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, role text, can_access_routing boolean, can_access_lawn boolean, can_access_call_log boolean, can_access_responder boolean, can_access_timesheet boolean, can_access_books boolean, can_access_tracker boolean, can_access_hub boolean, can_access_fleet boolean, can_access_zone_sizer boolean, can_access_dialer boolean, can_access_txt boolean, can_access_unified_inbox boolean, can_post_shout_outs boolean, can_access_marketing boolean, can_admin_marketing boolean, can_access_forms boolean, can_admin_forms boolean, can_admin_products boolean, can_access_daily_log_v2 boolean, can_access_call_log2 boolean, can_access_scoreboards boolean, can_access_files boolean, can_access_pesticide_records boolean, can_access_pricer boolean, can_admin_people boolean, can_admin_hub boolean, can_admin_guardian boolean, can_admin_txt boolean, can_admin_announcements boolean, can_admin_file_tags boolean, can_admin_routing boolean, can_admin_timesheet boolean, can_admin_fleet boolean, can_admin_daily_log boolean, can_admin_zone_sizer boolean, can_admin_dialer boolean, can_admin_contacts boolean, dialer_global_ring boolean, display_name text, avatar_url text, invite_sent_at timestamp with time zone, phone text, full_name text)
 language sql
 security definer
 set search_path to 'public'
as $function$
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
    up.can_admin_people, up.can_admin_hub,
    up.can_admin_guardian, up.can_admin_txt, up.can_admin_announcements, up.can_admin_file_tags,
    up.can_admin_routing, up.can_admin_timesheet, up.can_admin_fleet, up.can_admin_daily_log,
    up.can_admin_zone_sizer, up.can_admin_dialer, up.can_admin_contacts,
    up.dialer_global_ring, hu.display_name, hu.avatar_url,
    up.invite_sent_at, up.phone, up.full_name
  FROM public.user_profiles up
  JOIN auth.users au ON au.id = up.id
  LEFT JOIN public.hub_users hu ON hu.id = up.id
$function$;

revoke all on function public.get_admin_users() from public, anon;
grant execute on function public.get_admin_users() to authenticated;
