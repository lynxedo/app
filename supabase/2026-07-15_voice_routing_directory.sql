-- AI Voice Receptionist — Level 5 (frontline receptionist) config.
--
-- Level 5 puts the receptionist at the FRONT of every inbound call, replacing
-- the IVR/auto-attendant. To route callers to the right person or department she
-- needs a per-company routing directory: each entry is a person OR a department
-- with a plain-English "what they handle" description (her triage text) and a
-- single destination. The destination reuses the SAME identifiers the IVR
-- already dials (Hub user id / E.164 / ring-group id / extension / voicemail),
-- so call-time transfers need no new plumbing.
--
-- Additive + inert: this table + the two new settings columns are read only by
-- the (dark, level-5-gated) frontline code. Applying this migration does not
-- change any current call behavior. Mirrors the voice_scheduling_services
-- posture: RLS enabled, NO policies → only the service-role admin client (which
-- the voice/admin endpoints already use) can read/write it.

-- ── The routing directory ───────────────────────────────────────────────────
create table if not exists public.voice_routing_directory (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  label        text not null,                       -- what Amber calls it: "Kathryn", "Billing"
  kind         text not null default 'person'
                 check (kind in ('person', 'department')),
  description  text not null default '',            -- "what they handle" — Amber's triage text
  -- Exactly one destination per entry, encoded the same way the IVR encodes a
  -- node destination (lib/twilio-voice.ts renderIvrDestination):
  --   user       -> dest_value = Hub user id (uuid)   -> <Client>{id}</Client>
  --   cell       -> dest_value = E.164 number         -> <Number>{e164}</Number>
  --   ring_group -> dest_value = ring group id        -> ring-group route
  --   extension  -> dest_value = dialer_extension str  -> resolves to a user
  --   voicemail  -> dest_value = '' (company box)
  dest_kind    text not null default 'user'
                 check (dest_kind in ('user', 'cell', 'ring_group', 'extension', 'voicemail')),
  dest_value   text not null default '',
  enabled      boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Upsert-by-label (same pattern voice_scheduling_services uses for line_item),
  -- so the admin editor can save the whole list idempotently.
  unique (company_id, label)
);

create index if not exists voice_routing_directory_company_idx
  on public.voice_routing_directory (company_id, sort_order);

alter table public.voice_routing_directory enable row level security;
-- No policies on purpose: service-role only (bypasses RLS), matching
-- voice_scheduling_services. Never read with a user-scoped client.

-- ── Two new settings on the shared receptionist row ──────────────────────────
-- escape_ring_group: the ring group an AI-averse caller is sent to when they
--   ask to bypass Amber ("just connect me"); no answer → company voicemail,
--   exactly like the IVR does today. NULL → the bypass is unavailable.
-- transfer_miss_behavior: what Amber does when a transfer she attempts isn't
--   answered (Ben, Jul 15 2026 — a configurable setting):
--     offer_callback (default, Heroes) — return to the caller, keep helping if
--       she can, else promise a callback + take a detailed message
--     message  — take a message and end warmly
--     voicemail — send the caller to the company voicemail
alter table public.voice_receptionist_settings
  add column if not exists escape_ring_group text,
  add column if not exists transfer_miss_behavior text not null default 'offer_callback';

-- Backfill/repair guard for the check (add constraint only if missing).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'voice_receptionist_settings_transfer_miss_behavior_check'
  ) then
    alter table public.voice_receptionist_settings
      add constraint voice_receptionist_settings_transfer_miss_behavior_check
      check (transfer_miss_behavior in ('offer_callback', 'message', 'voicemail'));
  end if;
end $$;
