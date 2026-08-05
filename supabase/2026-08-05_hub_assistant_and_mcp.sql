-- Hub Assistant + official Lynxedo MCP — additive foundation.
--
-- APPLIED to the shared DB on 2026-08-05 via Supabase MCP (migration
-- `hub_assistant_and_mcp_2026_08_05`). This file is the repo record.
--
-- See Reference/PRDs/HUB_ASSISTANT_AND_MCP_PRD.md.
--
-- Every table here is RLS-enabled with NO policies: service-role only, matching
-- the company_integrations / inbox_accounts precedent. The app always reaches
-- these through the admin client after resolving a HubActor server-side
-- (lib/hub-actions/actor.ts) — the actor's company_id, never a request value, is
-- what scopes each query.

-- 1) Per-company assistant settings. Defaults OFF so this ships dark.
CREATE TABLE IF NOT EXISTS public.hub_assistant_settings (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  mcp_enabled boolean NOT NULL DEFAULT false,
  require_confirmation boolean NOT NULL DEFAULT true,
  disabled_actions text[] NOT NULL DEFAULT '{}'::text[],
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.hub_assistant_settings ENABLE ROW LEVEL SECURITY;

-- 2) Outward actions staged for confirmation. The assistant previews, the human
--    confirms. short_id is what the model echoes back to confirm_action.
--    ⚠ This row — not a prompt instruction — is what makes a customer text
--    unskippable-by-injection. See lib/hub-actions/pending.ts.
CREATE TABLE IF NOT EXISTS public.hub_assistant_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id text NOT NULL,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  action text NOT NULL,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  preview text NOT NULL,
  source text NOT NULL DEFAULT 'guardian',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
ALTER TABLE public.hub_assistant_pending_actions ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS hub_assistant_pending_short_id_uniq
  ON public.hub_assistant_pending_actions (short_id);
CREATE INDEX IF NOT EXISTS hub_assistant_pending_lookup_idx
  ON public.hub_assistant_pending_actions (company_id, user_id, status);

-- 3) One row per assistant/MCP request — usage meter + audit trail.
CREATE TABLE IF NOT EXISTS public.hub_assistant_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid,
  source text NOT NULL,
  tool_name text,
  tool_calls integer NOT NULL DEFAULT 0,
  input_tokens integer,
  output_tokens integer,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hub_assistant_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS hub_assistant_events_company_created_idx
  ON public.hub_assistant_events (company_id, created_at);

-- 4) OAuth 2.1 dynamically-registered clients (public clients, no secret).
--    Registration happens BEFORE any user signs in, so there is no company_id.
--    Registration grants nothing: a client can only act after a human consents.
CREATE TABLE IF NOT EXISTS public.mcp_oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text,
  redirect_uris text[] NOT NULL DEFAULT '{}'::text[],
  grant_types text[] NOT NULL DEFAULT '{authorization_code,refresh_token}'::text[],
  token_endpoint_auth_method text NOT NULL DEFAULT 'none',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mcp_oauth_clients ENABLE ROW LEVEL SECURITY;

-- 5) Short-lived authorization codes, bound to a PKCE challenge + redirect_uri.
CREATE TABLE IF NOT EXISTS public.mcp_oauth_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL,
  client_id uuid NOT NULL REFERENCES public.mcp_oauth_clients(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  code_challenge_method text NOT NULL DEFAULT 'S256',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
ALTER TABLE public.mcp_oauth_codes ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS mcp_oauth_codes_hash_uniq
  ON public.mcp_oauth_codes (code_hash);

-- 6) Bearer tokens. kind: 'personal' (pasted into Claude Code/cowork, no expiry)
--    | 'access' (OAuth, 1h) | 'refresh' (OAuth, rotated on use).
--    Only the sha256 hash is stored — the raw value is shown once at mint.
--    Kept separate from user_api_tokens (the browser extension's table) so
--    revoking a Claude connection can't disturb someone's extension, and so
--    expiry/rotation doesn't have to be bolted onto never-expiring tokens.
CREATE TABLE IF NOT EXISTS public.mcp_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL,
  token_prefix text,
  kind text NOT NULL,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  client_id uuid REFERENCES public.mcp_oauth_clients(id) ON DELETE CASCADE,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
);
ALTER TABLE public.mcp_tokens ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS mcp_tokens_hash_uniq ON public.mcp_tokens (token_hash);
CREATE INDEX IF NOT EXISTS mcp_tokens_user_idx ON public.mcp_tokens (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_tokens_company_idx ON public.mcp_tokens (company_id, created_at DESC);

-- 7) Billing counter — assistant requests per company per window.
--    ⚠ Registering 'assistant_requests' here is only 1 of 4 required edits; it also
--    needs USAGE_RPC (lib/billing/usage-report.ts), lib/billing/invoice.ts, and
--    WIRED_METER_EVENTS (lib/billing/wired-meters.ts) or it provisions but bills $0.
--    All four are done as of this migration.
CREATE OR REPLACE FUNCTION public.billing_usage_assistant_requests(
  p_company uuid, p_from timestamptz, p_to timestamptz
) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(COUNT(*), 0)::bigint FROM public.hub_assistant_events
  WHERE company_id = p_company AND created_at >= p_from AND created_at < p_to;
$$;
-- Recreating a SECURITY DEFINER function re-grants PUBLIC EXECUTE by default.
REVOKE ALL ON FUNCTION public.billing_usage_assistant_requests(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_usage_assistant_requests(uuid, timestamptz, timestamptz) TO service_role;

-- 8) Catalog item so the assistant is billable as a metered add-on (applied as a
--    separate statement on 2026-08-05; recorded here for completeness).
-- INSERT INTO public.billing_catalog
--   (feature_key, label, description, category, is_base, included_in_base,
--    default_price_cents, gate_flags, metered, meter_event_name, usage_unit,
--    unit_price_cents, sort_order, active)
-- VALUES ('hub_assistant', 'Hub AI Assistant', '…', 'operations', false, false,
--         0, '{}', true, 'assistant_requests', 'request', 2.000000, 110, true)
-- ON CONFLICT (feature_key) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 9) HARDENING after an adversarial review of the confirmation gate.
--    APPLIED to the shared DB on 2026-08-05 via Supabase MCP (migration
--    `hub_assistant_confirm_turn_binding_2026_08_05`).
--
--    The gate was defeatable: stageOutwardAction handed the confirmation id back
--    to the MODEL, and confirm_action required nothing the model couldn't supply.
--    So a prompt injected into tenant data (a customer's text, a lead form, a
--    voicemail transcript) that the assistant reads as a TOOL RESULT could drive
--    send_customer_text in one loop iteration and confirm_action in the next — a
--    real outbound SMS with attacker-authored content, no human approving.
--
--    The row proved a valid preview was CREATED by this actor; it never proved a
--    human APPROVED it. The fix binds confirmation to something the model cannot
--    manufacture: a later assistant turn.
ALTER TABLE public.hub_assistant_pending_actions
  ADD COLUMN IF NOT EXISTS staged_turn_id text;

--    Over MCP we can't see turn boundaries (each tools/call is its own request),
--    so the turn binding can't protect that door — approval would rest entirely
--    on the connected Claude client's own per-tool confirmation UI. Customer-facing
--    actions are therefore off over MCP unless a company opts in deliberately.
ALTER TABLE public.hub_assistant_settings
  ADD COLUMN IF NOT EXISTS allow_outward_over_mcp boolean NOT NULL DEFAULT false;
