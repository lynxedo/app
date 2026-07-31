-- Durable AI-receptionist marker on calls (2026-07-30).
--
-- Bug: `call_type='ai_receptionist'` (set by /api/voice/brain at call start) is NOT
-- durable — the transcription/grading pipeline (lib/call-transcribe.ts) overwrites
-- call_type with the content classification (inbound_cs/inbound_sales/other/…). So
-- Amber's COMPLETED calls lose the marker and get counted as DIALER minutes, and
-- billing_usage_ai_minutes (which filtered call_type='ai_receptionist') always returned 0.
--
-- Fix: a boolean handled_by_ai that grading never touches, set by the brain, and used by
-- the usage counters + the Call Log "via Amber" attribution instead of call_type.
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS handled_by_ai boolean NOT NULL DEFAULT false;

-- Backfill the only rows still identifiable as Amber's (the ones grading never reclassified).
-- Historical completed Amber calls already lost the marker and can't be recovered — the
-- flag captures every Amber call going forward.
UPDATE public.calls SET handled_by_ai = true WHERE call_type = 'ai_receptionist';

-- Repoint the usage counters at the durable flag.
CREATE OR REPLACE FUNCTION public.billing_usage_ai_minutes(p_company uuid, p_from timestamptz, p_to timestamptz)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(SUM(CEIL(duration_seconds/60.0)),0)::bigint FROM public.calls
  WHERE company_id=p_company AND created_at>=p_from AND created_at<p_to
    AND handled_by_ai=true AND status='completed' AND duration_seconds>0;
$$;

CREATE OR REPLACE FUNCTION public.billing_usage_dialer_minutes(p_company uuid, p_from timestamptz, p_to timestamptz)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(SUM(CEIL(duration_seconds/60.0)),0)::bigint FROM public.calls
  WHERE company_id=p_company AND created_at>=p_from AND created_at<p_to
    AND handled_by_ai=false AND status='completed' AND duration_seconds>0;
$$;
