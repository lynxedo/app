-- Amber's temporary instructions — "Right Now" notes that outrank the Knowledge Base
--
-- Ben, Aug 24 2026: *"So it would be nice if there was an easy spot where i can give
-- Amber the AI receptionist temporary instructions without having to go into the
-- knowledge base... And perhaps we put in an expiration of when those instructions
-- expire."* And, on what they are FOR: *"my temporary instructions are meant to
-- supersede what is in the knowledge base. That is the whole point. That way we can
-- customize how she works from day to day."*
--
-- ⚠⚠ WHY THIS IS NOT JUST A TEXT BOX. Ben's three examples look like one feature but
-- are three different mechanisms, and two of them are decided by Amber's TOOLS, not by
-- what she has been told:
--
--   (1) "You can schedule up to 4 irrigation service calls for Monday the 31st"
--   (2) "Ok we are booked for today. Do not book any more."
--   (3) "Kathryn is off today, transfer calls to me"
--
-- (1) and (2) are booking capacity. `voice_scheduling_services.max_per_day` already
-- caps bookings per service per day, and app/api/voice/availability counts real Jobber
-- visits against it, then hands Amber a sentence that reads:
--     "The first opening for Irrigation Repair is Monday, August 31st ... If that works,
--      confirm the details with the caller and then book it.
--      [When the caller agrees, call book_appointment with service=..., date=...]"
-- A prompt note saying "don't book today" therefore does NOT settle the matter — it
-- puts Amber in front of two contradictory directives, and the tool's is the more
-- specific one and arrives later in the conversation. She would probably obey the note,
-- but "probably" is not a booking policy.
--
-- (3) is routing. A note changes her WORDS; `route_call` and the transfer TwiML still
-- ring whoever is in `voice_receptionist_settings.transfer_user_ids` /
-- `voice_routing_directory`. She would say "let me get Ben" and ring Kathryn's phone.
--
-- So a note carries BOTH a spoken line (which supersedes the KB, by position and by an
-- explicit precedence header) AND, for the structured kinds, the numbers the tools
-- actually resolve against. The spoken line is what lets her EXPLAIN the limit; the
-- structured fields are what stop her contradicting herself.
--
-- ⚠ SUPERSEDING IS ABOUT BEHAVIOUR, NOT FACTS. Notes are appended at the END of the
-- system prompt, after COMPANY IDENTITY and every Knowledge Base doc (see the layout in
-- lib/guardian-persona.ts buildGuardianSystem), under a header saying they outrank what
-- came before. That reliably changes what she DOES. It cannot make her un-know a KB
-- fact: a note reading "we don't do irrigation anymore" will be followed, but the KB
-- still says you do, and a caller who pushes may surface it. Day-to-day operating rules
-- are the supported use; fact-erasure is not.
--
-- ⚠ A NOTE TAKES EFFECT ON THE NEXT CALL. The whole brain is fetched once at call
-- connect (app/api/voice/brain), so a call already in progress finishes under the rules
-- it started with. Seconds, not minutes — but not mid-call.

create table if not exists public.voice_receptionist_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,

  -- 'text'        — free-form instruction, prompt only.
  -- 'booking_cap' — a per-day booking limit the availability tool enforces.
  -- 'coverage'    — someone is out; their transfers go to somebody else.
  kind text not null check (kind in ('text', 'booking_cap', 'coverage')),

  -- The spoken line. Always present, for EVERY kind: it is what Amber reads, so she
  -- can explain a limit rather than just refusing. For the structured kinds it is
  -- generated from the fields at write time and re-generated on edit.
  body text not null,

  -- ── booking_cap ──────────────────────────────────────────────────────────────
  -- cap_date     the day being capped (company-local, America/Chicago).
  -- cap_service  the schedulable service's line_item, or NULL for ALL services.
  -- cap_max_jobs how many may be booked that day. 0 = none; she takes a message.
  cap_date date,
  cap_service text,
  cap_max_jobs int check (cap_max_jobs is null or cap_max_jobs >= 0),

  -- ── coverage ─────────────────────────────────────────────────────────────────
  -- Transfers aimed at out_user_id are re-pointed to cover_user_id, in BOTH transfer
  -- paths (the flat transfer list at Levels 1-4, and the Level 5 routing directory).
  out_user_id uuid references auth.users(id) on delete cascade,
  cover_user_id uuid references auth.users(id) on delete cascade,

  -- ── lifetime ─────────────────────────────────────────────────────────────────
  -- expires_at NULL = stands until cancelled. Cancelling is a soft delete so a note
  -- that recurs ("we're booked today") can be re-added from history in one tap.
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  cancelled_at timestamptz,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  -- Each kind must actually carry the fields its resolver reads. Without this a
  -- booking_cap row with a NULL cap_date is accepted and then silently never matches
  -- any day — the note LOOKS live on the card while enforcing nothing.
  constraint voice_note_kind_fields check (
    (kind = 'text')
    or (kind = 'booking_cap' and cap_date is not null and cap_max_jobs is not null)
    or (kind = 'coverage' and out_user_id is not null and cover_user_id is not null)
  ),
  -- Re-pointing someone's calls to themselves is a no-op that reads on the card as
  -- real coverage.
  constraint voice_note_coverage_distinct check (
    kind <> 'coverage' or out_user_id <> cover_user_id
  )
);

-- The call-time read: "every live note for this company, right now". Partial on the
-- soft-delete so cancelled rows never enter the hot path.
create index if not exists voice_receptionist_notes_live_idx
  on public.voice_receptionist_notes (company_id, expires_at)
  where cancelled_at is null;

-- The card's history read (newest first, cancelled and expired included).
create index if not exists voice_receptionist_notes_recent_idx
  on public.voice_receptionist_notes (company_id, created_at desc);

-- Service-role only, same as report_goals / marketing_spend: every reader of this
-- table is a service-role route (the voice endpoints, the Hub API), and the public
-- schema grants anon ALL by default — so RLS on with NO policies, plus an explicit
-- revoke, is the closed door.
alter table public.voice_receptionist_notes enable row level security;
revoke all on public.voice_receptionist_notes from anon, authenticated;
