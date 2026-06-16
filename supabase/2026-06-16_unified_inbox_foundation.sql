-- Unified Inbox — Session 1: Backend foundation
-- Created: June 16, 2026
-- Spec: Reference/PRDs/UNIFIED_INBOX_PRD.md §4.1 + UNIFIED_INBOX_SESSIONS.md "Session 1"
--
-- Additive + read-only. Adds the access flag and the timeline-merge RPC.
-- Nothing on prod references either until the Session 6 cutover, so this is
-- safe to apply to the shared DB immediately (same pattern as can_access_txt /
-- can_access_call_log2 / can_access_daily_log_v2).

-- ── 1. Access flag ─────────────────────────────────────────────────────────
-- Read-only gate for the unified inbox view. Send/call actions still gate on
-- the caller's existing can_access_txt / can_access_dialer flags (PRD §6).
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS can_access_unified_inbox boolean NOT NULL DEFAULT false;

-- ── 2. Timeline merge RPC (call ↔ voicemail dedup baked in) ─────────────────
-- Returns one chronological event list for a contact: texts (bubbles), calls,
-- voicemails, and notes. SECURITY DEFINER bypasses RLS, so EVERY sub-SELECT is
-- filtered by p_company_id and the contact is verified to belong to that
-- company up front (PRD §6 — same discipline as search_hub_messages).
--
-- The dedup is the point of this session: a missed/no-answer call that left a
-- voicemail is ONE event (the call row, carrying the voicemail's audio /
-- transcript / summary, with voicemail_id set). Orphan voicemails (call_id IS
-- NULL) get their own rows. A call is NEVER rendered twice. You cannot detect
-- the link via calls.status (only some carry status='voicemail') — the
-- voicemails.call_id FK is the only reliable signal.

CREATE OR REPLACE FUNCTION public.get_contact_timeline(
  p_contact_id uuid,
  p_company_id uuid
)
RETURNS TABLE (
  kind text,              -- 'text' | 'call' | 'voicemail' | 'note'
  ts timestamptz,
  id uuid,                -- the source row id (call.id / message.id / vm.id / note.id)
  direction text,         -- 'inbound' | 'outbound' (null for notes)
  body text,              -- text body / note body (null for call/vm)
  media_urls text[],      -- text attachments
  actor uuid,             -- sent_by (text) / initiated_by (call) / created_by (note)
  status text,            -- text delivery status / call status ('completed'|'no-answer'|'voicemail')
  duration_seconds integer,
  recording_path text,    -- R2 path; signed lazily by the UI on expand
  transcript text,
  summary text,
  sentiment text,
  voicemail_id uuid,      -- non-null on a 'call' row => combined missed-call+vm marker
  ai_reply_sent_at timestamptz  -- Guardian auto-reply marker (voicemail)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Texts → chat bubbles (the visual spine)
  SELECT 'text'::text, m.created_at, m.id, m.direction, m.body, m.media_urls,
         m.sent_by, m.status,
         NULL::int, NULL::text, NULL::text, NULL::text, NULL::text,
         NULL::uuid, NULL::timestamptz
  FROM public.txt_messages m
  WHERE m.contact_id = p_contact_id
    AND m.company_id = p_company_id

  UNION ALL

  -- Calls, with their linked voicemail folded in (LEFT JOIN on voicemails.call_id).
  -- A call that left a voicemail carries the VM's recording/transcript/summary
  -- and a non-null voicemail_id => UI shows ONE combined "missed call + vm" marker.
  SELECT 'call'::text, c.created_at, c.id, c.direction, NULL::text, NULL::text[],
         c.initiated_by, c.status,
         c.duration_seconds,
         COALESCE(v.recording_storage_path, c.recording_storage_path),
         COALESCE(v.transcript, c.transcript),
         COALESCE(v.summary, c.ai_summary),
         c.sentiment,
         v.id,
         v.ai_reply_sent_at
  FROM public.calls c
  LEFT JOIN public.voicemails v
    ON v.call_id = c.id
   AND v.deleted_at IS NULL
   AND v.company_id = p_company_id
  WHERE c.contact_id = p_contact_id
    AND c.company_id = p_company_id

  UNION ALL

  -- ORPHAN voicemails only (no parent call) — the linked ones are already folded
  -- into their call row above, so this avoids the double-render the PRD warns of.
  SELECT 'voicemail'::text, vm.created_at, vm.id, 'inbound'::text, NULL::text, NULL::text[],
         NULL::uuid, NULL::text,
         vm.recording_duration_sec, vm.recording_storage_path, vm.transcript, vm.summary,
         NULL::text,
         vm.id,
         vm.ai_reply_sent_at
  FROM public.voicemails vm
  WHERE vm.contact_id = p_contact_id
    AND vm.company_id = p_company_id
    AND vm.deleted_at IS NULL
    AND vm.call_id IS NULL

  UNION ALL

  -- Notes — joined to the contact through the conversation (txt_notes has no contact_id)
  SELECT 'note'::text, n.created_at, n.id, NULL::text, n.body, NULL::text[],
         n.created_by, NULL::text,
         NULL::int, NULL::text, NULL::text, NULL::text, NULL::text,
         NULL::uuid, NULL::timestamptz
  FROM public.txt_notes n
  JOIN public.txt_conversations conv ON conv.id = n.conversation_id
  WHERE conv.contact_id = p_contact_id
    AND n.company_id = p_company_id
    AND conv.company_id = p_company_id

  -- Order by ordinal position: col 2 = ts, col 1 = kind. (Column names aren't
  -- resolvable across a UNION whose first SELECT leaves its columns unaliased.)
  ORDER BY 2 ASC, 1 ASC;
$function$;

-- Lock execution to the authenticated role. SECURITY DEFINER bypasses RLS, so
-- the anon role must NOT be able to call this via PostgREST — Postgres grants
-- EXECUTE to PUBLIC by default, so we REVOKE that first (mirrors search_hub_messages).
-- App-level access is then gated by the API route checking can_access_unified_inbox.
REVOKE EXECUTE ON FUNCTION public.get_contact_timeline(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_contact_timeline(uuid, uuid) TO authenticated;

-- Index check (PRD §4.5): per-contact lookups are covered by existing
-- contact_id indexes on calls / voicemails / txt_messages, and voicemails.call_id
-- (idx_voicemails_call_id) covers the dedup join. No new index needed for the
-- per-contact timeline; the (company_id, *) left-rail sort index is Session 3.

-- ── 3. Expose the new flag to the Admin → People panel ─────────────────────
-- get_admin_users() powers the Admin panel's initial render. Add the new column
-- to its return so the toggle shows correct initial state. CREATE OR REPLACE
-- can't widen a RETURNS TABLE, so DROP + CREATE (atomic in one migration). The
-- DROP resets the ACL to default PUBLIC, so the function is re-locked below.
DROP FUNCTION public.get_admin_users();

CREATE FUNCTION public.get_admin_users()
 RETURNS TABLE(id uuid, email text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, role text, can_access_routing boolean, can_access_lawn boolean, can_access_call_log boolean, can_access_responder boolean, can_access_timesheet boolean, can_access_books boolean, can_access_tracker boolean, can_access_hub boolean, can_access_fleet boolean, can_access_zone_sizer boolean, can_access_dialer boolean, can_access_txt boolean, can_access_unified_inbox boolean, can_post_shout_outs boolean, can_access_marketing boolean, can_admin_marketing boolean, can_access_forms boolean, can_admin_forms boolean, can_admin_products boolean, can_access_daily_log_v2 boolean, can_access_call_log2 boolean, can_access_scoreboards boolean, can_admin_people boolean, can_admin_hub boolean, can_admin_guardian boolean, can_admin_txt boolean, can_admin_announcements boolean, can_admin_file_tags boolean, can_admin_routing boolean, can_admin_timesheet boolean, can_admin_fleet boolean, can_admin_daily_log boolean, can_admin_zone_sizer boolean, can_admin_dialer boolean, can_admin_contacts boolean, dialer_global_ring boolean, display_name text, avatar_url text, invite_sent_at timestamp with time zone, phone text, full_name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    up.id, au.email::text, au.created_at, au.last_sign_in_at, up.role,
    up.can_access_routing, up.can_access_lawn, up.can_access_call_log,
    up.can_access_responder, up.can_access_timesheet, up.can_access_books,
    up.can_access_tracker, up.can_access_hub, up.can_access_fleet,
    up.can_access_zone_sizer, up.can_access_dialer, up.can_access_txt,
    up.can_access_unified_inbox,
    up.can_post_shout_outs,
    up.can_access_marketing, up.can_admin_marketing, up.can_access_forms,
    up.can_admin_forms, up.can_admin_products, up.can_access_daily_log_v2,
    up.can_access_call_log2, up.can_access_scoreboards,
    up.can_admin_people, up.can_admin_hub,
    up.can_admin_guardian, up.can_admin_txt, up.can_admin_announcements, up.can_admin_file_tags,
    up.can_admin_routing, up.can_admin_timesheet, up.can_admin_fleet, up.can_admin_daily_log,
    up.can_admin_zone_sizer, up.can_admin_dialer, up.can_admin_contacts,
    up.dialer_global_ring, hu.display_name, hu.avatar_url,
    up.invite_sent_at, up.phone, up.full_name
  FROM public.user_profiles up
  JOIN auth.users au ON au.id = up.id
  LEFT JOIN public.hub_users hu ON hu.id = up.id
$function$;

REVOKE EXECUTE ON FUNCTION public.get_admin_users() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_admin_users() TO authenticated, service_role;
