-- Amber-over-text — the AI voice receptionist ("Amber") answering DRIP SMS
-- replies in the Txt thread (Track D). Additive only; WRITE now, APPLY later.
-- All tables company_id-scoped (multi-tenant from day 1). Mirrors the drip
-- engine migration (2026-07-16_drip_engine.sql) for RLS + index conventions.
--
-- Flow: when a drip lead replies, the drip engine pauses the enrollment
-- (status 'replied') and lib/amber-text.ts maybeEnqueueAmberTurn() upserts an
-- amber_text_threads row with next_turn_at = now() + grace. A per-minute cron
-- (/api/amber/text/process) drains due rows via runAmberTextTurn(), which reuses
-- the shared Guardian brain over the thread history + Amber's tools, then either
-- sends as the Amber bot user (autonomy 'auto', not test mode) or logs a draft.
-- A human sending or claiming the thread flips status to 'human' → Amber goes
-- silent. Everything is DARK by default (dials default off, autonomy 'draft').
--
-- Writes go through the service-role admin client; authenticated users get
-- company-scoped SELECT.

-- ── One row per Txt conversation Amber is (or was) driving over text ──────────
create table if not exists public.amber_text_threads (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  -- One Amber thread per Txt conversation (enables the upsert onConflict target).
  conversation_id uuid not null references public.txt_conversations(id) on delete cascade,
  -- active     — Amber owns the thread and answers due turns
  -- human      — a real teammate seized the thread (sent / claimed) → Amber silent
  -- handed_off — Amber reached the max-turn cap or couldn't proceed → needs a human
  -- opted_out  — the lead replied STOP / is do_not_text → never text again
  -- completed  — the goal was met (e.g. booked) and Amber is done
  status         text not null default 'active',
  enrollment_id  uuid references public.drip_enrollments(id) on delete set null,
  level          smallint,                            -- resolved dial level driving behavior
  turn_count     integer not null default 0,          -- Amber replies sent so far (max-turn cap)
  last_turn_at   timestamptz,
  next_turn_at   timestamptz,                          -- due time for the next turn (null = not queued)
  created_at     timestamptz not null default now(),
  unique (conversation_id)
);
-- Drainer selector: active threads whose next turn is due.
create index if not exists idx_amber_threads_due on public.amber_text_threads(next_turn_at) where status = 'active';
create index if not exists idx_amber_threads_company on public.amber_text_threads(company_id, status);
create index if not exists idx_amber_threads_enrollment on public.amber_text_threads(enrollment_id);

-- ── Flag Amber-authored Txt messages (so the UI + history can label them, and
--    the first-message AI-disclosure check knows whether Amber has spoken) ─────
alter table public.txt_messages
  add column if not exists is_ai boolean default false;

-- ── Amber-over-text settings on the shared receptionist settings row ──────────
--   text_enabled   — company-level master switch for Amber-over-text (dark default)
--   text_level     — override the spoken-receptionist level for text (else falls
--                    back to voice_receptionist_settings.level); a per-line
--                    txt_phone_numbers.amber_text_level overrides this in turn
--   text_autonomy  — 'auto' = Amber sends automatically; 'draft' (default) =
--                    Amber composes but does NOT send (logged for review) — dark
--   text_bot_user_id — the hub_users row Amber's texts are attributed to (sent_by)
alter table public.voice_receptionist_settings
  add column if not exists text_enabled boolean default false,
  add column if not exists text_level smallint,
  add column if not exists text_autonomy text default 'draft',
  add column if not exists text_bot_user_id uuid;

-- ── Per-line (per Twilio number) Amber-over-text dial ─────────────────────────
--   amber_text_enabled — the ON/OFF dial for THIS line (both this AND the company
--                        text_enabled master must be true for Amber to engage)
--   amber_text_level   — optional per-line level override (else the company level)
alter table public.txt_phone_numbers
  add column if not exists amber_text_enabled boolean default false,
  add column if not exists amber_text_level smallint;

-- ── RLS (company-scoped SELECT; writes via the service-role admin client) ─────
alter table public.amber_text_threads enable row level security;

create policy amber_text_threads_select_company on public.amber_text_threads
  for select to authenticated
  using (company_id in (select up.company_id from public.user_profiles up where up.id = auth.uid()));

-- ── Integrator TODO (post-apply, NOT part of this migration's automatic run) ──
-- 1. Seed a dedicated Amber bot user in hub_users (is_bot = true) so her texts
--    are clearly attributed, e.g.:
--      insert into public.hub_users (id, company_id, display_name, is_bot)
--      values (gen_random_uuid(), '<company-uuid>', 'Amber', true)
--      returning id;
-- 2. Point the settings row at it and (when ready) turn the dials on:
--      update public.voice_receptionist_settings
--         set text_bot_user_id = '<amber-bot-user-id>',
--             text_enabled     = true,       -- company master (leave false to stay dark)
--             text_autonomy    = 'auto'      -- 'draft' stays dark (compose-only)
--       where company_id = '<company-uuid>';
--      update public.txt_phone_numbers
--         set amber_text_enabled = true      -- the per-line dial
--       where id = '<phone-number-id>';
-- 3. Wire the cron (prod VPS only, like the drip engine):
--      curl -s -X POST https://lynxedo.com/api/amber/text/process -H "x-cron-secret: $CRON_SECRET"
-- 4. Call maybeEnqueueAmberTurn(...) from app/api/txt/twilio/sms/inbound after
--    pauseEnrollmentsForInbound (passing the paused enrollment id + the inbound
--    line's phone_number_id).
