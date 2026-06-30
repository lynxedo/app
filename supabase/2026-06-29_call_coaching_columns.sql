-- Phase 2 of the call-coaching feature: queryable coaching columns on the
-- dialer `calls` table, backfilled from coaching already computed and stored in
-- call_ai_results.transcript_json.analysis.coaching (engine deepgram_claude).
-- Applied to the shared Supabase DB on 2026-06-29 via the Supabase MCP.
-- New calls are populated by lib/call-transcribe.ts (write-through on transcribe).

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS coaching_grade              text,
  ADD COLUMN IF NOT EXISTS coaching_headline           text,
  ADD COLUMN IF NOT EXISTS coaching_must_listen        boolean,
  ADD COLUMN IF NOT EXISTS coaching_must_listen_reason text,
  ADD COLUMN IF NOT EXISTS coaching_red_flags          jsonb,
  ADD COLUMN IF NOT EXISTS coaching_never_dos          jsonb,
  ADD COLUMN IF NOT EXISTS coaching_wins               jsonb,
  ADD COLUMN IF NOT EXISTS coaching_improvements       jsonb,
  ADD COLUMN IF NOT EXISTS coaching_json               jsonb;

-- Backfill from existing deepgram_claude coaching (safe to re-run).
WITH src AS (
  SELECT call_id, transcript_json #> '{analysis,coaching}' AS coaching
  FROM public.call_ai_results
  WHERE engine = 'deepgram_claude'
    AND transcript_json #> '{analysis,coaching}' IS NOT NULL
)
UPDATE public.calls c
SET coaching_json               = src.coaching,
    coaching_grade              = src.coaching ->> 'overall_grade',
    coaching_headline           = src.coaching ->> 'headline',
    coaching_must_listen        = NULLIF(src.coaching ->> 'must_listen','')::boolean,
    coaching_must_listen_reason = src.coaching ->> 'must_listen_reason',
    coaching_red_flags          = src.coaching -> 'red_flags',
    coaching_never_dos          = src.coaching -> 'never_dos_triggered',
    coaching_wins               = src.coaching -> 'wins',
    coaching_improvements       = src.coaching -> 'improvements'
FROM src
WHERE c.id = src.call_id;
