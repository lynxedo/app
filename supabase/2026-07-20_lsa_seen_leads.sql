-- Applied to the shared Supabase DB on 2026-07-20 (migration lsa_seen_leads_2026_07_20).
-- Durable ledger of every Google LSA lead the poller has processed. Survives
-- deletion of the leads row, so a dismissed junk lead can never be re-ingested /
-- re-announced by the every-5-min poll (the "resurrection loop"). See
-- app/api/google/lsa/poll/route.ts.
create table if not exists public.lsa_seen_leads (
  company_id     uuid        not null,
  google_lead_id text        not null,
  lead_id        uuid,                                   -- the leads row we created, if any
  disposition    text        not null default 'created', -- created | skipped_phone_call | preexisting
  lead_type      text,
  first_seen_at  timestamptz not null default now(),
  primary key (company_id, google_lead_id)
);

alter table public.lsa_seen_leads enable row level security;
-- Service-role only (the poller uses the admin client). No policies => no anon/authenticated access.
revoke all on public.lsa_seen_leads from anon, authenticated;
