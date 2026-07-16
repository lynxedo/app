-- Google (Ads + Local Services) OAuth connection, one row per company.
-- Foundation for the LSA lead poller + Google Ads API. Tokens are service-role
-- only (RLS on, no policies) like company_integrations; the app reads them
-- through the admin client in lib/google-oauth.ts. Plaintext tokens match the
-- existing jobber_tokens / gusto_connections handling (encryption is a follow-up).
--
-- Applied to the shared DB 2026-07-16 via Supabase migration
-- `2026_07_16_google_connections`.
create table if not exists public.google_connections (
  company_id       uuid primary key,
  google_email     text,
  refresh_token    text not null,
  access_token     text,
  token_expires_at timestamptz,
  scope            text,
  connected_by     uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.google_connections enable row level security;
comment on table public.google_connections is 'Per-company Google OAuth (Ads + Local Services API) tokens. Service-role only (RLS on, no policies).';
