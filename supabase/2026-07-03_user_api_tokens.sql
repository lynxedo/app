-- 2026-07-03_user_api_tokens.sql
-- Per-user, revocable API tokens for the Lynxedo browser extension (and any
-- future non-cookie integration: mobile, Zapier, etc.). See
-- Reference/PRDs/CHROME_EXTENSION_PRD.md §4.1.
--
-- The app authenticates humans via Supabase session cookies, which an extension
-- can't cleanly reuse cross-origin. Instead a user mints a long random token in
-- Settings → Integrations; we store ONLY its SHA-256 hash here (the raw token is
-- shown once and never persisted). Extension endpoints resolve the token → user
-- → company and gate on it, separate from the cookie-session path.
--
-- Additive only. Multi-tenant safe: company_id scopes every row so a future
-- tenant's tokens can never resolve to another company.

create table if not exists user_api_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  company_id   uuid not null,
  token_hash   text not null,             -- sha256 hex of the raw token
  token_prefix text not null,             -- first chars of the raw token, for display ("lyx_ext_ab12…")
  label        text,                      -- user-supplied ("My laptop")
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);

-- Fast auth lookup: hash → active token. Unique on hash (collisions impossible
-- in practice; the constraint also blocks accidental duplicate inserts).
create unique index if not exists user_api_tokens_token_hash_uniq
  on user_api_tokens (token_hash);

-- List a user's own tokens (Settings screen) newest-first.
create index if not exists user_api_tokens_user_idx
  on user_api_tokens (user_id, created_at desc);

-- RLS: a user may read/insert/update ONLY their own tokens (revoke = update
-- revoked_at). The extension auth path itself uses the service-role admin client
-- (it has no cookie session), so it bypasses RLS — these policies just guard the
-- cookie-session management UI in Settings.
alter table user_api_tokens enable row level security;

drop policy if exists user_api_tokens_owner_select on user_api_tokens;
create policy user_api_tokens_owner_select on user_api_tokens
  for select using ((select auth.uid()) = user_id);

drop policy if exists user_api_tokens_owner_insert on user_api_tokens;
create policy user_api_tokens_owner_insert on user_api_tokens
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists user_api_tokens_owner_update on user_api_tokens;
create policy user_api_tokens_owner_update on user_api_tokens
  for update using ((select auth.uid()) = user_id);
