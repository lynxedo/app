-- Irrigation System Inventory — per-customer irrigation inspections, one row per
-- saved visit (snapshot-per-visit history) + a `can_access_irrigation` permission
-- flag. Viewing the saved system rides on can_access_hub (anyone who can open the
-- customer); creating / editing / finalizing / texting a summary is gated to
-- can_access_irrigation (admins always). The customer-facing summary page is a
-- public, unguessable-token read (no login) that shows customer-safe fields only.
--
-- ADDITIVE. Applied to the shared DB via Supabase MCP apply_migration
-- `irrigation_inventory_2026_07_31`.
--
-- ⚠ get_admin_users(uuid) is SECURITY DEFINER; adding a return column forces
-- DROP+CREATE, which re-grants EXECUTE to anon/PUBLIC by Supabase default. We
-- re-REVOKE anon and restore the exact prior ACL (authenticated + service_role).

-- 1) Permission flag ---------------------------------------------------------
alter table public.user_profiles
  add column if not exists can_access_irrigation boolean not null default false;

-- 2) Inspections table -------------------------------------------------------
-- Each row is one saved inspection. A `draft` is the in-progress working copy
-- (at most one open per contact); `finalize` flips it to `final` and stamps the
-- visit date, becoming a permanent dated snapshot.
create table if not exists public.irrigation_inspections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid not null references public.txt_contacts(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'final')),
  data jsonb not null default '{}'::jsonb,
  sketch_key text,
  photo_keys text[] not null default '{}',
  share_token text unique,
  share_expires_at timestamptz,
  inspected_on date,
  finalized_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists irrigation_inspections_company_contact_idx
  on public.irrigation_inspections (company_id, contact_id, status, finalized_at desc);

-- At most one open draft per contact (safety net; the routes also enforce it).
create unique index if not exists irrigation_inspections_one_draft_idx
  on public.irrigation_inspections (company_id, contact_id)
  where status = 'draft';

create index if not exists irrigation_inspections_share_token_idx
  on public.irrigation_inspections (share_token)
  where share_token is not null;

alter table public.irrigation_inspections enable row level security;

-- Read-isolation only: company members can read their company's inspections.
-- ALL writes go through the service-role admin client with per-route
-- authorization (can_access_irrigation). The public summary page also uses the
-- admin client, keyed by the verified share_token, and touches only that row.
drop policy if exists irrigation_inspections_select on public.irrigation_inspections;
create policy irrigation_inspections_select on public.irrigation_inspections
  for select to authenticated
  using (company_id in (select company_id from public.user_profiles where id = auth.uid()));

-- 3) Widen get_admin_users(uuid) to expose can_access_irrigation -------------
drop function if exists public.get_admin_users(uuid);
create function public.get_admin_users(p_company_id uuid)
 returns table(id uuid, email text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, role text, can_access_routing boolean, can_access_lawn boolean, can_access_call_log boolean, can_access_responder boolean, can_access_timesheet boolean, can_access_books boolean, can_access_tracker boolean, can_access_hub boolean, can_access_fleet boolean, can_access_zone_sizer boolean, can_access_dialer boolean, can_access_txt boolean, can_access_unified_inbox boolean, can_post_shout_outs boolean, can_access_marketing boolean, can_admin_marketing boolean, can_access_forms boolean, can_admin_forms boolean, can_admin_products boolean, can_access_daily_log_v2 boolean, can_access_call_log2 boolean, can_access_scoreboards boolean, can_access_files boolean, can_access_pesticide_records boolean, can_access_pricer boolean, can_access_email boolean, can_admin_email boolean, can_manage_drip boolean, can_access_coaching boolean, can_access_beta boolean, can_access_shared_inbox boolean, can_compose_shared_email boolean, can_manage_shared_inbox boolean, can_access_irrigation boolean, can_admin_people boolean, can_admin_hub boolean, can_admin_guardian boolean, can_admin_ai boolean, can_admin_txt boolean, can_admin_announcements boolean, can_admin_file_tags boolean, can_admin_routing boolean, can_admin_timesheet boolean, can_admin_fleet boolean, can_admin_daily_log boolean, can_admin_zone_sizer boolean, can_admin_dialer boolean, can_admin_contacts boolean, can_admin_integrations boolean, dialer_global_ring boolean, display_name text, avatar_url text, invite_sent_at timestamp with time zone, phone text, full_name text, locked_at timestamp with time zone, deactivated_at timestamp with time zone)
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
    up.can_access_irrigation,
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
