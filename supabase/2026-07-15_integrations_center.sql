-- Admin → Integrations: one consolidated home where a subscriber connects their
-- external lead/data sources and business systems (Jobber, QuickBooks, Gusto,
-- Angi, Meta, email sending domains, Google Ads/LSA, Thumbtack, Networx,
-- Zillow, …). Consolidates connect UIs that were scattered across User
-- Settings, Time Records, Email Marketing, Social Marketing, and the Books page.
--
-- APPLIED to the shared DB on 2026-07-15 via Supabase MCP (migration
-- `add_integrations_center`). This file is the repo record.
--
-- Fully additive + inert until the Integrations code ships: (1) a new
-- can_admin_integrations gate, (2) the company_integrations spine, (3)
-- get_admin_users() widened to expose the new flag.

-- (1) New admin gate for the Integrations area. Grandfather anyone who already
-- administers a module that owns an integration connect UI today (Time
-- Records = Gusto, Email Marketing = Resend domains, Social Marketing = Meta,
-- Dialer = voice AI) so nobody loses the path they had. Super-admins always
-- have it via the isSuperAdmin bypass, so they need no row change.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS can_admin_integrations boolean NOT NULL DEFAULT false;

UPDATE public.user_profiles
  SET can_admin_integrations = true
  WHERE can_admin_timesheet OR can_admin_email OR can_admin_marketing OR can_admin_dialer;

-- (2) Per-company, per-provider integration registry — the SaaS spine. Every
-- integration (present + future) gets one row per company. OAuth connection
-- STATE still lives in each provider's own token table (jobber_tokens,
-- qbo_tokens, gusto_connections, social_accounts, email_sending_identities);
-- this table holds the per-tenant SETTINGS (destination board/stage,
-- lead-source label, on/off), a status mirror for display, and — for
-- inbound-webhook providers (Angi, Google Ads lead form, Thumbtack, …) — a
-- per-tenant inbound token + hashed key so ONE endpoint can route a lead to
-- the right company. Secrets: only the SHA-256 hash of the inbound key is
-- stored (raw shown once), same model as user_api_tokens. Reversible OAuth
-- refresh tokens are NEVER stored here — they stay in the provider tables.
CREATE TABLE IF NOT EXISTS public.company_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider text NOT NULL,           -- 'jobber' | 'quickbooks' | 'gusto' | 'angi' | 'meta' | 'email' | 'google_ads' | 'google_lsa' | 'thumbtack' | 'networx' | 'zillow'
  status text NOT NULL DEFAULT 'not_connected', -- 'not_connected' | 'action_needed' | 'connected' | 'error'
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  webhook_token text,               -- opaque per-tenant token carried in the inbound URL (routes lead → company)
  webhook_key_hash text,            -- sha256 of the inbound shared secret; raw shown once
  webhook_key_prefix text,          -- display hint for the key
  last_synced_at timestamptz,
  last_error text,
  connected_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, provider)
);

CREATE UNIQUE INDEX IF NOT EXISTS company_integrations_webhook_token_key
  ON public.company_integrations (webhook_token)
  WHERE webhook_token IS NOT NULL;

-- Service-role only (the admin client bypasses RLS). Same "RLS on, no policies"
-- pattern as gusto_connections and qbo_tokens — these rows hold connection
-- config/secrets and must never be read by a normal client.
ALTER TABLE public.company_integrations ENABLE ROW LEVEL SECURITY;

-- (3) get_admin_users() widened to expose can_admin_integrations. RETURNS TABLE
-- change needs DROP + CREATE; body + ACL are otherwise identical to the prior
-- (2026-07-10) version. can_admin_integrations is inserted right after
-- can_admin_contacts in both the RETURNS TABLE signature and the SELECT list.
-- Re-grant is MANDATORY after DROP+CREATE — Supabase re-grants anon EXECUTE by
-- default on recreate, and this function exposes every user's email + grants.
DROP FUNCTION IF EXISTS public.get_admin_users();
CREATE FUNCTION public.get_admin_users()
 RETURNS TABLE(id uuid, email text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, role text, can_access_routing boolean, can_access_lawn boolean, can_access_call_log boolean, can_access_responder boolean, can_access_timesheet boolean, can_access_books boolean, can_access_tracker boolean, can_access_hub boolean, can_access_fleet boolean, can_access_zone_sizer boolean, can_access_dialer boolean, can_access_txt boolean, can_access_unified_inbox boolean, can_post_shout_outs boolean, can_access_marketing boolean, can_admin_marketing boolean, can_access_forms boolean, can_admin_forms boolean, can_admin_products boolean, can_access_daily_log_v2 boolean, can_access_call_log2 boolean, can_access_scoreboards boolean, can_access_files boolean, can_access_pesticide_records boolean, can_access_pricer boolean, can_access_email boolean, can_admin_email boolean, can_access_coaching boolean, can_access_beta boolean, can_admin_people boolean, can_admin_hub boolean, can_admin_guardian boolean, can_admin_ai boolean, can_admin_txt boolean, can_admin_announcements boolean, can_admin_file_tags boolean, can_admin_routing boolean, can_admin_timesheet boolean, can_admin_fleet boolean, can_admin_daily_log boolean, can_admin_zone_sizer boolean, can_admin_dialer boolean, can_admin_contacts boolean, can_admin_integrations boolean, dialer_global_ring boolean, display_name text, avatar_url text, invite_sent_at timestamp with time zone, phone text, full_name text, locked_at timestamp with time zone, deactivated_at timestamp with time zone)
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
    up.can_admin_integrations,
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
