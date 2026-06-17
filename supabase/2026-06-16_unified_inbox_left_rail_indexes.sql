-- Unified Inbox — Session 3: left-rail cross-channel activity indexes
-- Created: June 16, 2026
-- Spec: Reference/PRDs/UNIFIED_INBOX_PRD.md §4.5 + UNIFIED_INBOX_SESSIONS.md "Session 3"
--
-- Additive + read-only (index-only DDL). The left rail now sorts each contact
-- by GREATEST(last text, last call, last voicemail) and filters on missed /
-- voicemail. That enrichment query is `WHERE company_id = $1 AND contact_id IN
-- (...)` against calls + voicemails. The existing indexes are (company_id,
-- created_at DESC) and a bare (contact_id) — neither is the ideal composite for
-- that access pattern. PRD §4.5 (citing the June 14 IO-budget outage caused by
-- missing company_id indexes) says to add (company_id, contact_id) in Session 3.
--
-- Tables are tiny today (calls ~151, voicemails ~34, txt_messages ~186) so a
-- plain CREATE INDEX is instant; the sub-ms write lock on calls is negligible.

-- calls: rail enrichment filters by company_id + contact_id (always non-null in
-- the IN list). Partial index keeps it small and matches the query.
CREATE INDEX IF NOT EXISTS calls_company_contact_idx
  ON public.calls (company_id, contact_id)
  WHERE contact_id IS NOT NULL;

-- voicemails: same access pattern, plus the merge always filters deleted_at IS
-- NULL (soft-deleted VMs never render). Partial index mirrors both predicates.
CREATE INDEX IF NOT EXISTS voicemails_company_contact_idx
  ON public.voicemails (company_id, contact_id)
  WHERE deleted_at IS NULL AND contact_id IS NOT NULL;

-- txt_messages: not used by the rail (the rail reads txt_conversations.last_message_at),
-- but the per-contact timeline RPC (Session 1) filters txt_messages by
-- contact_id + company_id. Add the composite for §4.5 completeness / IO defense.
CREATE INDEX IF NOT EXISTS txt_messages_company_contact_idx
  ON public.txt_messages (company_id, contact_id);
