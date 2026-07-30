-- Usage counters for the new metered catalog items (Track 5 follow-up, 2026-07-30).
--
-- Ben's four new usage-based items (call recording, transcripts, AI summaries, caller-ID
-- lookups) were all pointed at the Dialer's `call_minutes` meter, so each would have
-- billed on total call-minutes instead of its own metric. This gives each its OWN meter
-- + a counting RPC, matching the usage-report.ts pattern.
--
-- ⚠ Keep meter_event_name here in sync with USAGE_RPC (lib/billing/usage-report.ts) and
-- WIRED_METER_EVENTS (lib/billing/wired-meters.ts).

-- 1) Re-point each item at its own distinct meter. (These rows have no Stripe ids yet, so
--    the next "Sync to Stripe" provisions the correct meters cleanly.)
UPDATE billing_catalog SET meter_event_name = 'recording_minutes', updated_at = now() WHERE feature_key = 'call_recording';
UPDATE billing_catalog SET meter_event_name = 'transcript_minutes', updated_at = now() WHERE feature_key = 'call_transcripts';
UPDATE billing_catalog SET meter_event_name = 'ai_summaries',       updated_at = now() WHERE feature_key = 'ai_call_summaries';
UPDATE billing_catalog SET meter_event_name = 'caller_id_lookups',  updated_at = now() WHERE feature_key = 'caller_id_look_up';

-- 2) A precise log of paid caller-ID (Twilio CNAM) lookups — one row per billable dip.
--    Service-role only (RLS on, no policies), matching the other billing_* tables.
CREATE TABLE IF NOT EXISTS public.billing_caller_id_lookups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_caller_id_lookups ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS billing_caller_id_lookups_company_created_idx
  ON public.billing_caller_id_lookups (company_id, created_at);

-- 3) Counting RPCs, one per meter. Same signature/shape as billing_usage_dialer_minutes:
--    (company, from, to) -> bigint total, STABLE SECURITY DEFINER, service-role only.

-- Recorded minutes (calls with a recording).
CREATE OR REPLACE FUNCTION public.billing_usage_recording_minutes(p_company uuid, p_from timestamptz, p_to timestamptz)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(SUM(CEIL(recording_duration_seconds/60.0)),0)::bigint FROM public.calls
  WHERE company_id=p_company AND created_at>=p_from AND created_at<p_to
    AND recording_duration_seconds>0;
$$;

-- Transcribed minutes (calls whose transcription completed — note the value is 'complete').
CREATE OR REPLACE FUNCTION public.billing_usage_transcript_minutes(p_company uuid, p_from timestamptz, p_to timestamptz)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(SUM(CEIL(duration_seconds/60.0)),0)::bigint FROM public.calls
  WHERE company_id=p_company AND created_at>=p_from AND created_at<p_to
    AND transcription_status='complete' AND duration_seconds>0;
$$;

-- AI call summaries (count of calls that got an AI summary).
CREATE OR REPLACE FUNCTION public.billing_usage_ai_summaries(p_company uuid, p_from timestamptz, p_to timestamptz)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(COUNT(*),0)::bigint FROM public.calls
  WHERE company_id=p_company AND created_at>=p_from AND created_at<p_to
    AND ai_summary IS NOT NULL AND ai_summary <> '';
$$;

-- Caller-ID lookups (count of paid dips from the log above).
CREATE OR REPLACE FUNCTION public.billing_usage_caller_id_lookups(p_company uuid, p_from timestamptz, p_to timestamptz)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(COUNT(*),0)::bigint FROM public.billing_caller_id_lookups
  WHERE company_id=p_company AND created_at>=p_from AND created_at<p_to;
$$;

-- Lock the SECURITY DEFINER functions down to service_role (recreating them re-grants
-- PUBLIC EXECUTE by default — revoke it so anon/authenticated can't read usage totals).
REVOKE ALL ON FUNCTION public.billing_usage_recording_minutes(uuid,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.billing_usage_transcript_minutes(uuid,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.billing_usage_ai_summaries(uuid,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.billing_usage_caller_id_lookups(uuid,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_usage_recording_minutes(uuid,timestamptz,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_usage_transcript_minutes(uuid,timestamptz,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_usage_ai_summaries(uuid,timestamptz,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_usage_caller_id_lookups(uuid,timestamptz,timestamptz) TO service_role;
