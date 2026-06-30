-- Phase 4 of the call-coaching feature: manager score overrides + review state.
-- One row per reviewed call, keyed by (call_source, call_id) so it covers both
-- the Twilio dialer ('dialer' -> calls.id) and the Unitel log ('unitel' ->
-- call_logs.id). The AI coaching stays immutable; this is the human layer.
-- RLS on with no policies = service-role-only (coaching is manager-sensitive);
-- the app reads/writes it exclusively through the admin client.

CREATE TABLE IF NOT EXISTS public.call_coaching_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid,
  call_source text NOT NULL,        -- 'dialer' | 'unitel'
  call_id uuid NOT NULL,
  override_grade text,              -- A|B|C|D|F|N/A, null = no override
  manager_notes text,
  acknowledged boolean NOT NULL DEFAULT false,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS call_coaching_reviews_source_call_key
  ON public.call_coaching_reviews (call_source, call_id);

ALTER TABLE public.call_coaching_reviews ENABLE ROW LEVEL SECURITY;
