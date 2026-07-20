-- Track 5 (M4.5) — usage-based (metered) billing on top of the flat base fee.
-- Dialer (per call-minute), Txt (per outbound message), AI Receptionist (per call-minute).
-- Applied to the shared Supabase DB via MCP on 2026-07-20.

-- 1. Metered config on the catalog (flat base stays in default_price_cents).
ALTER TABLE public.billing_catalog
  ADD COLUMN IF NOT EXISTS metered boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meter_event_name text,        -- 'call_minutes' | 'ai_minutes' | 'text_messages'
  ADD COLUMN IF NOT EXISTS usage_unit text,              -- 'minute' | 'message'
  ADD COLUMN IF NOT EXISTS unit_price_cents integer,     -- per-unit rate (placeholder until Ben sets it)
  ADD COLUMN IF NOT EXISTS stripe_meter_id text,
  ADD COLUMN IF NOT EXISTS stripe_metered_price_id_test text,
  ADD COLUMN IF NOT EXISTS stripe_metered_price_id_live text;

UPDATE public.billing_catalog SET metered=true, meter_event_name='call_minutes',  usage_unit='minute',  unit_price_cents=COALESCE(unit_price_cents, 5)  WHERE feature_key='dialer';
UPDATE public.billing_catalog SET metered=true, meter_event_name='text_messages', usage_unit='message', unit_price_cents=COALESCE(unit_price_cents, 2)  WHERE feature_key='txt';
UPDATE public.billing_catalog SET metered=true, meter_event_name='ai_minutes',    usage_unit='minute',  unit_price_cents=COALESCE(unit_price_cents, 25) WHERE feature_key='ai_receptionist';

-- 2. Per-(company, meter, mode) watermark so the reporting job only reports NEW usage.
CREATE TABLE IF NOT EXISTS public.billing_usage_watermark (
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  meter_event_name text NOT NULL,
  mode             text NOT NULL DEFAULT 'test',
  watermarked_at   timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, meter_event_name, mode)
);
ALTER TABLE public.billing_usage_watermark ENABLE ROW LEVEL SECURITY; -- service-role only, no policies

-- 3. In-DB aggregation (scalar via .rpc(), sidestepping the supabase-js 1000-row cap).
--    Minutes rounded up PER CALL (Twilio-style): SUM(CEIL(seconds/60)).
CREATE OR REPLACE FUNCTION public.billing_usage_dialer_minutes(p_company uuid, p_from timestamptz, p_to timestamptz)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(SUM(CEIL(duration_seconds/60.0)),0)::bigint FROM public.calls
  WHERE company_id=p_company AND created_at>=p_from AND created_at<p_to
    AND call_type IS DISTINCT FROM 'ai_receptionist' AND status='completed' AND duration_seconds>0;
$$;
CREATE OR REPLACE FUNCTION public.billing_usage_ai_minutes(p_company uuid, p_from timestamptz, p_to timestamptz)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(SUM(CEIL(duration_seconds/60.0)),0)::bigint FROM public.calls
  WHERE company_id=p_company AND created_at>=p_from AND created_at<p_to
    AND call_type='ai_receptionist' AND status='completed' AND duration_seconds>0;
$$;
CREATE OR REPLACE FUNCTION public.billing_usage_text_count(p_company uuid, p_from timestamptz, p_to timestamptz)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(COUNT(*),0)::bigint FROM public.txt_messages
  WHERE company_id=p_company AND created_at>=p_from AND created_at<p_to
    AND direction='outbound' AND status IN ('sent','delivered');
$$;

REVOKE EXECUTE ON FUNCTION public.billing_usage_dialer_minutes(uuid,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.billing_usage_ai_minutes(uuid,timestamptz,timestamptz)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.billing_usage_text_count(uuid,timestamptz,timestamptz)     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_usage_dialer_minutes(uuid,timestamptz,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_usage_ai_minutes(uuid,timestamptz,timestamptz)     TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_usage_text_count(uuid,timestamptz,timestamptz)     TO service_role;
