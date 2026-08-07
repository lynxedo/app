-- OAuth hardening: durable rate-limit counters + session-bound authorization requests.
--
-- Both tables exist because the in-process equivalents were too thin for an
-- endpoint that mints credentials:
--
--  1) mcp_rate_limits — lib/rate-limit.ts counts in a Map that resets on every
--     deploy and is per-PM2-process. Acceptable for the extension endpoints it
--     was written for; not for /api/oauth/*, where "deploy = limits cleared" is
--     an attacker-triggerable reset (push traffic during a release window).
--
--  2) mcp_oauth_requests — the consent POST currently trusts its own form
--     fields for client_id / redirect_uri / code_challenge. Every one is
--     re-validated there, so this is not a live hole, but it means the PKCE
--     challenge that ends up on the code is whatever the FORM said, not what
--     the client actually sent to /oauth/authorize. Persisting the request at
--     authorize time and carrying only a one-time nonce through the form makes
--     the two the same thing by construction, and gives the CSRF control a
--     token rather than a header check.

-- ── 1) Durable rate-limit counters ──────────────────────────────────────────
-- Fixed window rather than sliding: one atomic upsert per check instead of a
-- row per hit, which matters when the thing being protected is on the latency
-- path of every token refresh. The edge case a fixed window allows (up to 2×
-- the limit across a window boundary) is irrelevant at these thresholds.
CREATE TABLE IF NOT EXISTS public.mcp_rate_limits (
  bucket_key   text        NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);
ALTER TABLE public.mcp_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS mcp_rate_limits_window_idx
  ON public.mcp_rate_limits (window_start);

-- Returns whether this hit is allowed, and how long until the window rolls.
-- Counting continues past the limit; that only affects the (unused) hit total,
-- never retry_after, which is derived from the window boundary.
CREATE OR REPLACE FUNCTION public.mcp_rate_limit_hit(
  p_key text, p_limit integer, p_window_seconds integer
) RETURNS TABLE (allowed boolean, retry_after integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_window_start timestamptz;
  v_hits integer;
BEGIN
  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.mcp_rate_limits (bucket_key, window_start, hits)
  VALUES (p_key, v_window_start, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET hits = public.mcp_rate_limits.hits + 1
  RETURNING public.mcp_rate_limits.hits INTO v_hits;

  -- Opportunistic sweep so a long tail of one-off keys can't grow the table.
  -- ~1% of calls, and only ever deletes windows that can no longer be hit.
  IF random() < 0.01 THEN
    DELETE FROM public.mcp_rate_limits WHERE window_start < now() - interval '1 hour';
  END IF;

  allowed := v_hits <= p_limit;
  retry_after := GREATEST(
    1,
    ceil(extract(epoch FROM (v_window_start + make_interval(secs => p_window_seconds) - now())))::integer
  );
  RETURN NEXT;
END;
$$;

-- ⚠ REVOKE FROM PUBLIC is NOT sufficient on Supabase, and this was verified the
-- hard way: after the PUBLIC revoke below, has_function_privilege still reported
-- EXECUTE for anon and authenticated, because ALTER DEFAULT PRIVILEGES grants
-- them directly on every new function. Left as it was, any unauthenticated
-- caller could burn a bucket through PostgREST and lock a real client out of
-- token refresh. anon/authenticated must be revoked BY NAME.
REVOKE ALL ON FUNCTION public.mcp_rate_limit_hit(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mcp_rate_limit_hit(text, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_rate_limit_hit(text, integer, integer) TO service_role;
-- Same reasoning for the tables. RLS-on-with-no-policies already denies these
-- roles every row, so this is the second lock rather than the only one.
REVOKE ALL ON TABLE public.mcp_rate_limits FROM anon, authenticated;

-- ── 2) Session-bound authorization requests ─────────────────────────────────
-- One row per rendered consent screen. The nonce is hashed, single-use, bound
-- to the user whose session rendered the page, and short-lived: it is a CSRF
-- token and the authoritative copy of the request parameters at once.
CREATE TABLE IF NOT EXISTS public.mcp_oauth_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce_hash            text        NOT NULL,
  client_id             uuid        NOT NULL REFERENCES public.mcp_oauth_clients(id) ON DELETE CASCADE,
  -- The signed-in user the consent screen was rendered for. A nonce minted for
  -- one person must not be redeemable by another.
  user_id               uuid        NOT NULL,
  redirect_uri          text        NOT NULL,
  code_challenge        text        NOT NULL,
  code_challenge_method text        NOT NULL DEFAULT 'S256',
  state                 text,
  resource              text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  consumed_at           timestamptz
);
ALTER TABLE public.mcp_oauth_requests ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS mcp_oauth_requests_nonce_uniq
  ON public.mcp_oauth_requests (nonce_hash);
CREATE INDEX IF NOT EXISTS mcp_oauth_requests_expiry_idx
  ON public.mcp_oauth_requests (expires_at);

REVOKE ALL ON TABLE public.mcp_oauth_requests FROM anon, authenticated;

-- No policies on either table: service_role bypasses RLS, and nothing else
-- should ever read them. RLS on with zero policies is deny-all for everyone
-- else, which is the intent.
