-- Push B: transcript confidence for dialer calls. Deepgram word data isn't
-- stored, but each utterance carries a confidence, so we average those into one
-- score. New calls: lib/call-transcribe.ts writeEngineResult computes it.
-- Historical: backfilled from transcript_json.deepgram.utterances.
-- Applied to the shared Supabase DB on 2026-06-30 via the Supabase MCP.

ALTER TABLE public.call_ai_results
  ADD COLUMN IF NOT EXISTS avg_confidence double precision;

UPDATE public.call_ai_results air
SET avg_confidence = sub.avgc
FROM (
  SELECT id,
    (SELECT avg((u->>'confidence')::float)
       FROM jsonb_array_elements(transcript_json->'deepgram'->'utterances') u) AS avgc
  FROM public.call_ai_results
  WHERE engine = 'deepgram_claude'
    AND jsonb_typeof(transcript_json->'deepgram'->'utterances') = 'array'
) sub
WHERE air.id = sub.id AND sub.avgc IS NOT NULL;
