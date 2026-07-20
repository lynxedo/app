-- Track 5/6 billing foundation (M1) — additive, DARK until code + Stripe wire it up.
-- Safe: no existing table/column altered destructively. Company-level gating (M3) fails OPEN
-- for any company with no subscription row, so existing tenants (incl. Heroes) are never gated
-- until explicitly put on a subscription.
-- Applied to the shared Supabase DB via MCP on 2026-07-20.

-- 1. Platform super-admin capability (separate from the company-scoped role='admin')
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

-- Grant Ben (owner/operator of Lynxedo) platform-admin.
UPDATE public.user_profiles
  SET is_platform_admin = true
  WHERE id = '6939b706-5135-448d-a28a-7674ba17974e';

-- 2. Pricing catalog — platform-wide price sheet; admin-managed, nothing hardcoded.
CREATE TABLE IF NOT EXISTS public.billing_catalog (
  feature_key         text PRIMARY KEY,
  label               text NOT NULL,
  description         text,
  category            text NOT NULL DEFAULT 'operations',
  is_base             boolean NOT NULL DEFAULT false,   -- the base subscription row (__base__)
  included_in_base    boolean NOT NULL DEFAULT false,   -- module included at no extra charge
  default_price_cents integer NOT NULL DEFAULT 0,       -- monthly price when billable
  cost_basis_cents    integer,                          -- Ben's underlying cost (margin view)
  usage_source        text,                             -- optional link to usage_snapshots.source
  usage_metric        text,                             -- optional link to usage_snapshots.metric
  gate_flags          text[] NOT NULL DEFAULT '{}',     -- the can_access_* flags this module governs
  stripe_product_id   text,
  stripe_price_id_test text,
  stripe_price_id_live text,
  sort_order          integer NOT NULL DEFAULT 100,
  active              boolean NOT NULL DEFAULT true,
  retired_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_catalog ENABLE ROW LEVEL SECURITY;
-- No policies: service-role (admin client) only, like company_integrations. Super-admin console
-- and the M3 entitlement resolver both read via the admin client.

-- 3. Per-company pricing overrides (null = inherit catalog default)
CREATE TABLE IF NOT EXISTS public.company_billing_overrides (
  company_id                uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  feature_key               text NOT NULL REFERENCES public.billing_catalog(feature_key) ON DELETE CASCADE,
  included_in_base_override boolean,
  price_cents_override      integer,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, feature_key)
);
ALTER TABLE public.company_billing_overrides ENABLE ROW LEVEL SECURITY;
-- service-role only

-- 4. Per-company Stripe subscription + billing state.
--    mode-namespaced because staging (Stripe TEST) and prod (Stripe LIVE) share ONE database.
CREATE TABLE IF NOT EXISTS public.company_subscription (
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  mode                  text NOT NULL DEFAULT 'test',   -- 'test' (staging) | 'live' (prod)
  stripe_customer_id    text,
  stripe_subscription_id text,
  status                text NOT NULL DEFAULT 'none',   -- none|trialing|active|past_due|canceled|incomplete
  trial_ends_at         timestamptz,
  current_period_end    timestamptz,
  cancel_at_period_end  boolean NOT NULL DEFAULT false,
  base_price_cents      integer,                        -- snapshot of base fee at subscribe time
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, mode)
);
ALTER TABLE public.company_subscription ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_subscription_own_read ON public.company_subscription
  FOR SELECT USING (company_id IN (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));
-- writes: service-role only (webhook/admin)

-- 5. Per-company module entitlements (which modules a company pays for; synced from Stripe items)
CREATE TABLE IF NOT EXISTS public.company_module_subscription (
  company_id                uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  feature_key               text NOT NULL REFERENCES public.billing_catalog(feature_key) ON DELETE CASCADE,
  mode                      text NOT NULL DEFAULT 'test',
  active                    boolean NOT NULL DEFAULT true,
  stripe_subscription_item_id text,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, feature_key, mode)
);
ALTER TABLE public.company_module_subscription ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_module_subscription_own_read ON public.company_module_subscription
  FOR SELECT USING (company_id IN (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));
-- writes: service-role only

-- 6. Seed the catalog. Prices are PLACEHOLDERS — Ben sets real numbers in the super-admin editor.
INSERT INTO public.billing_catalog
  (feature_key, label, description, category, is_base, included_in_base, default_price_cents, gate_flags, sort_order) VALUES
  ('__base__',        'Base platform subscription', 'Core platform: accounts, Hub messaging, contacts directory, tasks.', 'core', true,  false, 9900, '{}', 0),
  ('hub',             'Hub messaging',              'Team messaging: rooms, DMs, Guardian.',                               'core', false, true,  0,    '{can_access_hub}', 10),
  ('tracker',         'Lead & job tracker',         'Lead Tracker, recurring services, boards.',                           'core', false, true,  0,    '{can_access_tracker}', 20),
  ('forms',           'Forms',                      'Custom forms & submissions.',                                         'core', false, true,  0,    '{can_access_forms}', 30),
  ('timesheet',       'Time tracking',              'Clock in/out, timesheets, Gusto match.',                              'operations', false, true, 0, '{can_access_timesheet}', 40),
  ('dialer',          'Dialer (phone system)',      'Softphone, IVR, ring groups, voicemail, recording.',                  'communication', false, false, 4900, '{can_access_dialer,can_access_call_log,can_access_call_log2,can_access_unified_inbox}', 50),
  ('txt',             'Txt / SMS inbox',            'Two-way SMS/MMS inbox, templates, broadcasts.',                       'communication', false, false, 2900, '{can_access_txt}', 60),
  ('ai_receptionist', 'AI Receptionist (Amber)',    'AI voice receptionist that answers, triages, and books.',             'communication', false, false, 9900, '{}', 70),
  ('email',           'Email marketing',            'Campaigns, segments, automations (Resend).',                          'marketing', false, false, 3900, '{can_access_email}', 80),
  ('drip',            'Drip marketing',             'Multi-channel speed-to-lead nurture.',                                'marketing', false, false, 2900, '{can_manage_drip}', 90),
  ('social',          'Social marketing',           'Facebook / Instagram posting.',                                       'marketing', false, false, 1900, '{can_access_marketing}', 100),
  ('routing',         'Route optimizer',            'Jobber-integrated route builder.',                                    'operations', false, false, 3900, '{can_access_routing}', 110),
  ('fleet',           'Fleet tracker',              'Live GPS map + day history (OneStepGPS).',                            'operations', false, false, 2900, '{can_access_fleet}', 120),
  ('scoreboards',     'Scoreboards',                'KPI dashboards with weekly snapshots.',                               'operations', false, false, 1900, '{can_access_scoreboards}', 130),
  ('daily_log',       'Daily log / route sheet',    'Route sheet, tank loadout, on-my-way.',                               'operations', false, false, 1900, '{can_access_daily_log_v2}', 140),
  ('pricer',          'Pricing & products',         'Pricer, products, service mapping, pesticide records.',               'operations', false, false, 1900, '{can_access_pricer,can_access_pesticide_records}', 150),
  ('lawn_size',       'Lawn size measurement',      'Address to square footage (Mapbox + AI).',                            'operations', false, false, 1900, '{can_access_lawn,can_access_zone_sizer}', 160),
  ('books',           'Books (QuickBooks)',         'QBO-backed financial dashboard.',                                     'financial', false, false, 2900, '{can_access_books}', 170)
ON CONFLICT (feature_key) DO NOTHING;
