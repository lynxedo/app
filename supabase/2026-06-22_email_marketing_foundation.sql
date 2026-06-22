-- Email Marketing module — Session 1 foundation (additive).
-- Spec: Hub/EMAIL_MARKETING_PRD.md.
--   1) Access flags can_access_email / can_admin_email (default false; gated like every other tool).
--   2) Per-company sending identity in email_settings (configurable domain/From/Reply-To for the SaaS
--      future — NOT hardcoded). Heroes' row is seeded with the resolved heroeslawntx.com identity.
--   3) get_admin_users() must surface the two new flags so Admin -> People can show + toggle them.

-- ── 1. Access flags ──────────────────────────────────────────────────────────
alter table public.user_profiles
  add column if not exists can_access_email boolean not null default false;
alter table public.user_profiles
  add column if not exists can_admin_email  boolean not null default false;

-- ── 2. Per-company sending identity ─────────────────────────────────────────-
create table if not exists public.email_settings (
  company_id       uuid primary key references public.companies(id) on delete cascade,
  from_name        text,
  from_email       text,
  reply_to         text,
  sending_domain   text,
  domain_verified  boolean not null default false,
  resend_domain_id text,
  physical_address text,
  updated_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.email_settings enable row level security;

-- Company members may read their own company's sending identity. Writes go
-- through the admin API (service role), so no insert/update/delete policy —
-- mirrors the external_links pattern.
drop policy if exists email_settings_select_company ON public.email_settings;
create policy email_settings_select_company on public.email_settings
  for select using (
    company_id in (
      select up.company_id from public.user_profiles up where up.id = auth.uid()
    )
  );

-- Seed Heroes (company 00000000-0000-0000-0000-000000000002) with the resolved
-- identity (PRD §3a): the shared platform sending domain send.lynxedo.com with
-- the Heroes brand as the display name. domain_verified stays false until the
-- Resend domain + DNS are confirmed in the admin panel.
insert into public.email_settings
  (company_id, from_name, from_email, reply_to, sending_domain, physical_address)
values (
  '00000000-0000-0000-0000-000000000002',
  'Heroes Lawn Care of The Woodlands',
  'heroes@send.lynxedo.com',
  'hlc105@heroeslawncare.com',
  'send.lynxedo.com',
  null
)
on conflict (company_id) do nothing;

-- ── 3. get_admin_users() — add the two new flags ───────────────────────────-─
-- RETURNS TABLE can't be widened with CREATE OR REPLACE, so DROP + CREATE. That
-- resets the ACL to PUBLIC, so re-REVOKE from public/anon and re-GRANT to the
-- same roles as before (authenticated + service_role).
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
  can_access_pricer boolean,
  can_access_email boolean, can_admin_email boolean,
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
    up.can_access_pricer,
    up.can_access_email, up.can_admin_email,
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
