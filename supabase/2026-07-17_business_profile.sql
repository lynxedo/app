-- 2026-07-17_business_profile.sql
-- Per-company "business profile" — the tenant's customer-facing identity so a
-- future Lynxedo subscriber isn't hardcoded as "Heroes Lawn Care" in the strings
-- that reach THEIR customers (SMS signatures, the AI voice recap text, internal
-- branding headers). Read by lib/business-profile.ts, which falls back to the
-- exact current Heroes values for any company without a row — so this migration
-- is behavior-neutral on its own.
--
-- Design note (why a new table, not columns on `companies`):
--   `companies` is the lean tenant spine (name, plan_tier, subdomain_slug…) and
--   its RLS is relied on by many flows. A separate per-company settings table
--   matches the established pattern here (voice_receptionist_settings,
--   company_routing_settings, email_settings, responder_settings…), keeps the
--   branding/profile concern isolated, gives it its own RLS surface, and is fully
--   reversible (drop one table) with ZERO change to existing columns. That is the
--   lighter-blast-radius option.
--
-- Additive + non-destructive. One row per company (company_id is the PK).

create table if not exists public.business_profiles (
  company_id     uuid primary key references public.companies(id) on delete cascade,
  business_name  text,   -- null/blank -> HEROES_BUSINESS_PROFILE_FALLBACK.businessName ("Heroes Lawn Care")
  short_name     text,   -- null/blank -> "Heroes"
  city           text,   -- null/blank -> "The Woodlands"
  region         text,   -- null/blank -> "TX"
  service_area   text,   -- null/blank -> "The Woodlands, Spring, Magnolia, Conroe, and Tomball"
  phone          text,   -- null/blank -> "(832) 220-8100"
  signature_name text,   -- null/blank -> "Heroes Lawn Care"
  website        text,   -- null/blank -> "heroeslawncare.com"
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid
);

-- RLS: company-scoped READ, service-role WRITE.
-- The app reads this table through the service-role admin client (which bypasses
-- RLS), so these policies are defense-in-depth: a normal authenticated client may
-- read ONLY its own company's row, and no authenticated client may write — all
-- writes (a future Admin -> Business Profile editor) go through the service role.
alter table public.business_profiles enable row level security;

drop policy if exists business_profiles_company_select on public.business_profiles;
create policy business_profiles_company_select
  on public.business_profiles for select to authenticated
  using (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.company_id = business_profiles.company_id
    )
  );

-- (Intentionally no INSERT/UPDATE/DELETE policy for `authenticated` — writes are
--  service-role only, matching the "service-role write" requirement.)

-- ── OPTIONAL Heroes seed (company 00000000-0000-0000-0000-000000000002) ──────
-- SAFE + behavior-neutral: the resolver already returns these EXACT values when
-- no row exists, so seeding changes nothing today — it only makes Heroes' profile
-- explicit and editable once an admin UI exists. Values are byte-identical to
-- HEROES_BUSINESS_PROFILE_FALLBACK in lib/business-profile.ts. Left commented so a
-- human decides whether to insert it.
--
-- insert into public.business_profiles
--   (company_id, business_name, short_name, city, region, service_area, phone, signature_name, website)
-- values
--   ('00000000-0000-0000-0000-000000000002',
--    'Heroes Lawn Care', 'Heroes', 'The Woodlands', 'TX',
--    'The Woodlands, Spring, Magnolia, Conroe, and Tomball',
--    '(832) 220-8100', 'Heroes Lawn Care', 'heroeslawncare.com')
-- on conflict (company_id) do nothing;
