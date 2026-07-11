-- Phase 2 of the Admin → AI reorg: per-doc "Used by" audiences.
--
-- APPLIED to the shared DB on 2026-07-10 via Supabase MCP (migration
-- `add_knowledge_doc_audiences`). This file is the repo record.
--
-- audiences = which AI surfaces ('guardian' | 'responder' | 'receptionist')
-- auto-include this doc in their system prompt. Additive; backfilled to mirror
-- today's always_include reach EXACTLY, so buildGuardianSystem produces a
-- byte-identical prompt until an admin edits a doc's audiences via the new
-- "Used by" checkboxes in Admin → AI → Knowledge.

ALTER TABLE public.guardian_knowledge_docs
  ADD COLUMN IF NOT EXISTS audiences text[] NOT NULL DEFAULT '{}';

-- always_include docs reach all three AIs today → all three surfaces.
-- Everything else stays auto-excluded (still fetchable by the Hub agent by slug).
UPDATE public.guardian_knowledge_docs
  SET audiences = ARRAY['guardian','responder','receptionist']
  WHERE always_include = true;
