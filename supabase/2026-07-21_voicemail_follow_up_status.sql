-- 2026-07-21 — Per-voicemail follow-up marker for the Dialer VM tab.
-- Lets a user flag a voicemail as ✓ resolved ("taken care of") or 🚩 follow_up
-- ("needs follow-up"), alongside the existing heard/unheard state. NULL = no
-- marker (the default). follow_up_by/at mirror heard_by/heard_at for oversight.
-- Additive + nullable — no backfill, no behavior change for existing rows.
ALTER TABLE public.voicemails
  ADD COLUMN IF NOT EXISTS follow_up_status text
    CHECK (follow_up_status IN ('resolved', 'follow_up')),
  ADD COLUMN IF NOT EXISTS follow_up_by uuid,
  ADD COLUMN IF NOT EXISTS follow_up_at timestamp with time zone;
