-- Assistant conversation memory.
--
-- WHY. Guardian rebuilt every reply from nothing: the `messages` array it sent
-- to the model held only the newest user message, and the conversation was
-- re-injected as PLAIN TEXT in the system prompt from the visible room messages.
-- So the assistant could see what had been *said* but had no record of what it
-- had *done* — its own tool calls and their results were discarded at the end of
-- every turn.
--
-- Two consequences, both observed in production on 2026-08-14:
--   1. It re-ran the same lookups on every follow-up, because the answers were
--      gone (jobber_find_customer → jobber_get_customer_jobs, four times over).
--   2. Anything that existed ONLY in a tool result vanished. The confirmation
--      short_id is exactly that, so "yes" could not be turned into
--      confirm_action — it staged a fresh preview instead, and looped. Four
--      pending rows, no visit, until the id happened to appear in a visible
--      message and could be read back out of the transcript.
--
-- This table is the assistant's short-term memory: one row per completed turn,
-- scoped to a conversation.
--
-- ⚠ BOTH representations are written on EVERY turn regardless of the company's
-- memory_mode, and the mode only decides what gets REPLAYED. That is deliberate:
-- an owner who switches to 'full' partway through a long job can see the detail
-- of the turns that already happened, instead of the setting only taking effect
-- from the next message onward. Storage is cheap; a half-remembered project is
-- not.

create table if not exists hub_assistant_turn_memory (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  -- Which conversation this belongs to: 'room:<id>', 'conv:<id>' or 'dm:<user>'.
  -- Text rather than a FK because the three sources live in different tables.
  scope_key   text not null,
  user_id     uuid,
  -- Compact "what I did and which records I touched" note — the light mode.
  summary     text not null default '',
  -- The turn's real message blocks (tool_use + tool_result pairs, then the
  -- final answer), replayed verbatim in full mode. Always starts with the user
  -- message and ends with an assistant message so concatenated turns stay a
  -- valid alternating transcript.
  blocks      jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

-- The only read pattern: newest N turns for one conversation.
create index if not exists hub_assistant_turn_memory_scope_idx
  on hub_assistant_turn_memory (company_id, scope_key, created_at desc);

alter table hub_assistant_turn_memory enable row level security;

-- Server-side only, same as hub_assistant_pending_actions: every read and write
-- goes through the service role in lib/hub-actions. No client-facing policy is
-- granted, so a browser session cannot reach another person's turn history.

-- Per-company memory mode. 'light' is the default because it fixes the loop and
-- most of the re-fetching at negligible token cost; 'full' is opt-in because it
-- carries real transcript into every request and costs accordingly.
alter table hub_assistant_settings
  add column if not exists memory_mode text not null default 'light';

alter table hub_assistant_settings
  drop constraint if exists hub_assistant_settings_memory_mode_check;

alter table hub_assistant_settings
  add constraint hub_assistant_settings_memory_mode_check
  check (memory_mode in ('off', 'light', 'full'));
