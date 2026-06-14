-- ============================================================================
-- Phase 6 #45 — cross-device Txt2 unread dot. APPLIED 2026-06-14 (additive).
-- Shared prod+staging DB. Take a backup first:
--   https://supabase.com/dashboard/project/nhvwdulyzolevoeayjum/database/backups
-- ============================================================================

-- The Txt2 "unread" rail dot compared the newest customer inbound against a
-- per-DEVICE localStorage timestamp, so reading a thread on desktop never
-- cleared the dot on the same user's phone. This adds a per-USER server-side
-- "last opened Txt2" timestamp; /api/txt/seen stamps it and /api/txt/unread
-- reads it so every device of a user agrees. Additive nullable column.
alter table user_profiles add column if not exists txt_last_seen_at timestamptz;
