-- Scoreboard layouts — a board becomes "an ordered list of widget instances"
-- rather than a hardcoded view component. See Reference/PRDs/REPORTS_PRD.md §9.1.
--
-- Storage is deliberately an ORDERED LIST + COLUMN SPAN on a 12-column grid, not
-- absolute x/y: the user still drags to move and drags an edge to resize, but
-- every card collapses to full width on a phone for free, with no second layout
-- to maintain (§9.1.3).
--
-- Additive only. Nothing reads these tables until a layout row exists for a
-- board, and the existing hardcoded boards keep rendering until then.

create table if not exists public.scoreboard_layouts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  -- Matches lib/scoreboards/registry.ts slugs ('1'..'8') for a migrated board, or
  -- a generated slug for a board someone builds from scratch.
  slug          text not null,
  -- null = the company's SHARED board. Non-null = that person's own board.
  owner_user_id uuid references auth.users(id) on delete cascade,
  title         text not null,
  -- true = one we ship (a preset Report); guards it from casual deletion.
  is_preset     boolean not null default false,
  -- Who last reshaped it. A shared board changes for everyone, so "who moved my
  -- chart" needs an answer -- but this is tenant activity, NOT a platform-admin
  -- action, so it does not belong in platform_admin_audit. One column is the
  -- right size for it.
  updated_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One shared layout per slug per company; one personal layout per slug per user.
-- Two partial indexes rather than one nullable-column constraint, because in
-- Postgres NULLs don't collide and a plain unique index would let a company
-- accumulate duplicate shared boards.
create unique index if not exists scoreboard_layouts_shared_slug
  on public.scoreboard_layouts (company_id, slug)
  where owner_user_id is null;

create unique index if not exists scoreboard_layouts_owner_slug
  on public.scoreboard_layouts (company_id, owner_user_id, slug)
  where owner_user_id is not null;

create index if not exists scoreboard_layouts_company_idx
  on public.scoreboard_layouts (company_id);

create table if not exists public.scoreboard_layout_widgets (
  id          uuid primary key default gen_random_uuid(),
  layout_id   uuid not null references public.scoreboard_layouts(id) on delete cascade,
  -- Reading order. Rewritten wholesale on save, so gaps are harmless.
  position    integer not null,
  -- Stable id from the widget registry. Renaming a registry type orphans saved
  -- widgets, which is why the resolver reports an unknown type per-widget
  -- instead of failing the board.
  widget_type text not null,
  -- Columns of 12. 2 is the narrowest legible card; 3/4/6/12 are the named stops.
  span        integer not null default 4 check (span between 2 and 12),
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists scoreboard_layout_widgets_layout_idx
  on public.scoreboard_layout_widgets (layout_id, position);

-- RLS on, no policies: service-role only, same as the other recent tables
-- (jobber_webhook_events, jobber_backfill_jobs). All access goes through the
-- gated API route, which checks company + per-board grant + edit capability.
-- Deliberately NOT an own-row read policy: a permissive read here would expose
-- one person's private board to anyone who guessed its id.
alter table public.scoreboard_layouts        enable row level security;
alter table public.scoreboard_layout_widgets enable row level security;

revoke all on public.scoreboard_layouts        from anon, authenticated;
revoke all on public.scoreboard_layout_widgets from anon, authenticated;

-- Added same day, after the seed path failed in the browser.
-- One widget per position in a layout: semantically true (position IS the reading
-- order), and seeding relies on it — if two requests open a fresh board at once
-- and both see zero widgets, the second insert fails as a duplicate instead of
-- doubling every card. saveLayoutWidgets deletes the list and reinserts
-- sequential positions, so this never fights a normal save.
create unique index if not exists scoreboard_layout_widgets_layout_position_key
  on public.scoreboard_layout_widgets (layout_id, position);

-- ⚠ NOTE for anyone touching the seed path: the two unique indexes above are
-- PARTIAL, and Postgres will not accept a partial index as an ON CONFLICT
-- arbiter. Do not "simplify" seedPresetLayout() back into an .upsert() with
-- onConflict: 'company_id,slug' — it fails with "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification". Insert and handle 23505.
