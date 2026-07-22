-- Widen get_admin_users(uuid) to return can_manage_shared_inbox (Manager flag) so
-- Admin → People can show/edit the Manager toggle.
-- APPLIED to the shared DB via Supabase MCP apply_migration `get_admin_users_manage_inbox_2026_07_22`.
-- Return-type change → DROP + CREATE; re-revoke anon EXECUTE afterward (SECURITY DEFINER default re-grants it).

drop function if exists public.get_admin_users(uuid);
create function public.get_admin_users(p_company_id uuid)
 returns table(id uuid, email text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, role text, can_access_routing boolean, can_access_lawn boolean, can_access_call_log boolean, can_access_responder boolean, can_access_timesheet boolean, can_access_books boolean, can_access_tracker boolean, can_access_hub boolean, can_access_fleet boolean, can_access_zone_sizer boolean, can_access_dialer boolean, can_access_txt boolean, can_access_unified_inbox boolean, can_post_shout_outs boolean, can_access_marketing boolean, can_admin_marketing boolean, can_access_forms boolean, can_admin_forms boolean, can_admin_products boolean, can_access_daily_log_v2 boolean, can_access_call_log2 boolean, can_access_scoreboards boolean, can_access_files boolean, can_access_pesticide_records boolean, can_access_pricer boolean, can_access_email boolean, can_admin_email boolean, can_manage_drip boolean, can_access_coaching boolean, can_access_beta boolean, can_access_shared_inbox boolean, can_compose_shared_email boolean, can_manage_shared_inbox boolean, can_admin_people boolean, can_admin_hub boolean, can_admin_guardian boolean, can_admin_ai boolean, can_admin_txt boolean, can_admin_announcements boolean, can_admin_file_tags boolean, can_admin_routing boolean, can_admin_timesheet boolean, can_admin_fleet boolean, can_admin_daily_log boolean, can_admin_zone_sizer boolean, can_admin_dialer boolean, can_admin_contacts boolean, can_admin_integrations boolean, dialer_global_ring boolean, display_name text, avatar_url text, invite_sent_at timestamp with time zone, phone text, full_name text, locked_at timestamp with time zone, deactivated_at timestamp with time zone)
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
    up.can_access_email, up.can_admin_email,
    up.can_manage_drip,
    up.can_access_coaching,
    up.can_access_beta,
    up.can_access_shared_inbox, up.can_compose_shared_email, up.can_manage_shared_inbox,
    up.can_admin_people, up.can_admin_hub,
    up.can_admin_guardian, up.can_admin_ai, up.can_admin_txt, up.can_admin_announcements, up.can_admin_file_tags,
    up.can_admin_routing, up.can_admin_timesheet, up.can_admin_fleet, up.can_admin_daily_log,
    up.can_admin_zone_sizer, up.can_admin_dialer, up.can_admin_contacts,
    up.can_admin_integrations,
    up.dialer_global_ring, hu.display_name, hu.avatar_url,
    up.invite_sent_at, up.phone, up.full_name,
    up.locked_at, up.deactivated_at
  FROM public.user_profiles up
  JOIN auth.users au ON au.id = up.id
  LEFT JOIN public.hub_users hu ON hu.id = up.id
  WHERE up.company_id = p_company_id
$function$;

revoke all on function public.get_admin_users(uuid) from public;
revoke all on function public.get_admin_users(uuid) from anon;
grant execute on function public.get_admin_users(uuid) to authenticated;
grant execute on function public.get_admin_users(uuid) to service_role;
