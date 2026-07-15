-- AI Voice Receptionist — Level 5 frontline routing: record WHICH directory
-- entry a caller is being routed to, so the ConversationRelay <Connect action>
-- fallback route can dial that specific destination on [[TRANSFER]].
--
-- Additive + inert: written only by POST /api/voice/route (the route_call tool),
-- read only by the fallback route when a frontline call hands off. Nothing reads
-- these below Level 5.
alter table public.voice_transfer_attempts
  add column if not exists route_dest_kind text,   -- user | cell | ring_group | extension | voicemail
  add column if not exists route_dest_value text,  -- user id / E.164 / ring-group id / extension ('' for voicemail)
  add column if not exists route_label text;        -- the directory entry's label (for logging + the spoken confirm)
