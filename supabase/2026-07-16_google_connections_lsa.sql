-- LSA poller config on the per-company Google connection.
-- Applied to the shared DB 2026-07-16 via Supabase migration
-- `2026_07_16_google_connections_lsa`.
--
-- customer_id        = the Local Services / Google Ads account queried (per company)
-- login_customer_id  = the manager (MCC) to access through; null → env GOOGLE_ADS_LOGIN_CUSTOMER_ID
-- lsa_last_lead_time = poll cursor (newest local_services_lead creation time already ingested)
-- lsa_enabled        = per-company on/off for the LSA lead poll
alter table public.google_connections
  add column if not exists customer_id        text,
  add column if not exists login_customer_id  text,
  add column if not exists lsa_last_lead_time  timestamptz,
  add column if not exists lsa_enabled         boolean not null default true;
