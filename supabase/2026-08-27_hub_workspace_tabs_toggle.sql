-- Workspace Tabs per-user on/off switch (Hub Settings → My Hub).
--
-- Defaults TRUE because that is today's behaviour: tabs graduated out of beta
-- Aug 13 2026 and have been on for every desktop user with no opt-in. The column
-- only lets someone turn them OFF.
--
-- Read in app/hub/layout.tsx (via getCurrentProfile's select *) and passed to
-- HubShell as `initialTabsEnabled`, where it is ANDed with the desktop-environment
-- check — never OR'd, so ticking this on a phone still cannot produce a tab strip.
--
-- Applied to prod 2026-08-27.
alter table public.user_profiles
  add column if not exists hub_tabs_enabled boolean not null default true;

comment on column public.user_profiles.hub_tabs_enabled is
  'Per-user Workspace Tabs switch (Hub Settings -> My Hub). Default true = today''s behaviour. ANDed with the desktop-environment check.';
