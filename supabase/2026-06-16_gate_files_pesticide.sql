-- Gate Files + Pesticide Records behind per-user access flags (default OFF).
-- Additive + backward-compatible: existing prod/staging code ignores the new
-- columns; only the new build reads them. Admins always bypass in app code.
--
-- 1) Two new permission flags on user_profiles (NOT NULL DEFAULT false = locked
--    for everyone until explicitly granted in Admin -> People).
alter table public.user_profiles
  add column if not exists can_access_files boolean not null default false,
  add column if not exists can_access_pesticide_records boolean not null default false;

-- 2) get_admin_users() must return the two new columns so Admin -> People can
--    show + toggle them. A RETURNS TABLE signature can't be widened with
--    CREATE OR REPLACE, so DROP + CREATE. That resets the ACL to PUBLIC, so we
--    re-REVOKE from public/anon and re-GRANT to the same roles as before
--    (authenticated + service_role; postgres owns it).
drop function if exists public.get_admin_users();

create function public.get_admin_users()
returns table(
  id uuid, email text, created_at timestamp with time zone,
  last_sign_in_at timestamp with time zone, role text,
  can_access_routing boolean, can_access_lawn boolean, can_access_call_log boolean,
  can_access_responder boolean, can_access_timesheet boolean, can_access_books boolean,
  can_access_tracker boolean, can_access_hub boolean, can_access_fleet boolean,
  can_access_zone_sizer boolean, can_access_dialer boolean, can_access_txt boolean,
  can_access_unified_inbox boolean, can_post_shout_outs boolean,
  can_access_marketing boolean, can_admin_marketing boolean, can_access_forms boolean,
  can_admin_forms boolean, can_admin_products boolean, can_access_daily_log_v2 boolean,
  can_access_call_log2 boolean, can_access_scoreboards boolean,
  can_access_files boolean, can_access_pesticide_records boolean,
  can_admin_people boolean, can_admin_hub boolean,
  can_admin_guardian boolean, can_admin_txt boolean, can_admin_announcements boolean,
  can_admin_file_tags boolean, can_admin_routing boolean, can_admin_timesheet boolean,
  can_admin_fleet boolean, can_admin_daily_log boolean, can_admin_zone_sizer boolean,
  can_admin_dialer boolean, can_admin_contacts boolean, dialer_global_ring boolean,
  display_name text, avatar_url text, invite_sent_at timestamp with time zone,
  phone text, full_name text
)
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

revoke execute on function public.get_admin_users() from public, anon;
grant execute on function public.get_admin_users() to authenticated, service_role;
