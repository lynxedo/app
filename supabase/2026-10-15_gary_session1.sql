-- Gary (outbound sales agent) — session 1: his identity + settings.
-- PRD: Reference/PRDs/GARY_OUTBOUND_SALES_PRD.md (Drive).
--
-- Session 1 sends NOTHING. It gives Gary a Hub identity (a bot user, like Amber
-- and Guardian) and the settings the preview-only win-back list reads.
--
-- Additive + inert. RLS enabled with no policies → service-role only.

-- ── Gary's bot user (Heroes) ─────────────────────────────────────────────────
-- Cloned from Amber's auth row, the same way hers was cloned from Guardian's:
-- a @lynxedo.internal address (no company's google_domain matches it, so the
-- on_auth_user_created trigger creates no user_profiles row → he stays out of
-- every people picker), no password, and banned so the account can never sign in.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
  phone_change, phone_change_token, email_change_token_current,
  email_change_confirm_status, banned_until, reauthentication_token,
  is_sso_user, is_anonymous
)
select
  instance_id, '00000000-0000-0000-0001-000000000003', aud, role,
  'gary-bot@lynxedo.internal', encrypted_password, now(),
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, '{}'::jsonb, is_super_admin, now(), now(),
  phone_change, phone_change_token, email_change_token_current,
  email_change_confirm_status, '2999-01-01'::timestamptz, reauthentication_token,
  is_sso_user, is_anonymous
from auth.users
where id = '00000000-0000-0000-0001-000000000002'
on conflict (id) do nothing;

insert into public.hub_users (id, company_id, display_name, is_bot)
values ('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000002', 'Gary', true)
on conflict (id) do nothing;

-- ── Per-company settings ─────────────────────────────────────────────────────
create table if not exists public.gary_settings (
  company_id         uuid primary key references public.companies(id) on delete cascade,
  -- The hub_users bot row that is Gary for this company (verified is_bot +
  -- same company on every read).
  bot_user_id        uuid references public.hub_users(id) on delete set null,
  -- Services Gary may sell. Never mowing, never pet waste (Ben, Oct 15 2026);
  -- those are not offered as choices at all.
  services           text[] not null default '{irrigation,lawn_health,aeration,drainage,mosquito}',
  -- Skip anyone who has talked with us (text, call or email) in this many days.
  recent_touch_days  integer not null default 30 check (recent_touch_days between 1 and 365),
  updated_at         timestamptz not null default now(),
  updated_by         uuid
);
alter table public.gary_settings enable row level security;
revoke all on public.gary_settings from anon, authenticated;

insert into public.gary_settings (company_id, bot_user_id)
values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0001-000000000003')
on conflict (company_id) do nothing;
