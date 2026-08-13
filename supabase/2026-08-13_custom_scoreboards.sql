-- User-built Scoreboards — REPORTS_PRD.md §9 (the customizable half of §0.1).
--
-- A Report is a preset arrangement we ship; a Scoreboard is one a person
-- assembles from the same widget library and then chooses who can see. The
-- storage for the arrangement already exists (scoreboard_layouts +
-- scoreboard_layout_widgets, Aug 10). This adds the two things a user-built board
-- needs that a preset never did: an AUTHOR, and a share list.
--
-- Additive. Every existing row keeps working: created_by is null on the presets
-- (nobody built them), shared_all defaults false, and the new table starts empty.

-- Who built it. Distinct from `updated_by` (who last reshaped it) and from
-- `owner_user_id` (which means "this is a PRIVATE personal board" and stays null
-- for a custom board, because a custom board is a company object you share).
--
-- ⚠ Deliberately NOT reusing owner_user_id for authorship. That column is the
-- arbiter of the partial unique index scoreboard_layouts_owner_slug, and it also
-- drives `loadBoardLayout`'s "personal beats shared for the same slug" rule. A
-- custom board has its own unique slug and is meant to be shareable, so it is a
-- shared row with an author — overloading owner_user_id would make every custom
-- board invisible to everyone but its creator at the query level.
alter table public.scoreboard_layouts
  add column if not exists created_by uuid references auth.users(id) on delete set null;

-- "Everyone who can open Scoreboards", as an alternative to naming people.
-- A flag rather than a row per user: the membership is derived, so it keeps
-- working as staff join and leave without anyone re-sharing the board.
alter table public.scoreboard_layouts
  add column if not exists shared_all boolean not null default false;

create index if not exists scoreboard_layouts_created_by_idx
  on public.scoreboard_layouts (company_id, created_by);

-- Who a custom board has been shared with.
--
-- Keyed on layout_id, NOT on the slug text. `scoreboard_board_access` already
-- holds per-board grants for the eight boards we ship, and reusing it was
-- tempting — but a grant there is a slug string with no referent, so deleting a
-- custom board would leave orphan rows behind, and an admin managing built-in
-- board access would see a table with two different concepts in it. An FK with
-- ON DELETE CASCADE means deleting the board takes its sharing with it.
create table if not exists public.scoreboard_layout_access (
  id         uuid primary key default gen_random_uuid(),
  layout_id  uuid not null references public.scoreboard_layouts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- Who shared it, for "why can I see this?".
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists scoreboard_layout_access_unique
  on public.scoreboard_layout_access (layout_id, user_id);

create index if not exists scoreboard_layout_access_user_idx
  on public.scoreboard_layout_access (user_id);

-- RLS on with no policies = service-role only, matching scoreboard_layouts and
-- scoreboard_layout_widgets. Every read and write goes through the gated API
-- routes, which scope by company themselves.
--
-- Deliberately NOT an own-row read policy like report_access has. The rows are
-- only useful alongside the layout they point at, and scoreboard_layouts is
-- already service-role-only — a readable access table would let someone
-- enumerate layout ids they cannot open.
alter table public.scoreboard_layout_access enable row level security;

-- The durable half. Supabase grants anon and authenticated full access to public
-- tables by default, so policy-absence alone is what stands between anon and this
-- data, and a future permissive policy would silently open it. See memory
-- `lesson_backfill_snapshot_tables_need_rls`.
revoke all on public.scoreboard_layout_access from anon, authenticated;
