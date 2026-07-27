-- 2026-07-27 — Fix "statement timeout" on the Lead Source scoreboard (Board 8).
-- Applied LIVE to the shared DB via Supabase (migration `churn_source_resolver_lookup_indexes_2026_07_27`).
-- Idempotent (IF NOT EXISTS) — safe to re-run. Index-only, additive: NO code or logic change.
--
-- CONTEXT: `scoreboard_source_scorecard(company, year)` and `churn_resolve_source(...)` resolve each
-- in-scope recurring_services row's lead source PER ROW, and each row ran an unindexable
-- regexp_replace(phone,'\D','','g') sequential scan over clients (~1621) + leads (~687), plus a
-- regexp lateral join to clients. As the data grew this crossed the 8s `authenticated`-role
-- statement_timeout (measured 8,576 ms; the unbounded service_role/SQL-editor path still completed,
-- masking it), so the board failed to load for real users.
--
-- FIX: functional indexes whose expressions match the resolver's WHERE clauses EXACTLY, so the
-- per-row email/phone/name lookups become index scans. Result: 8,576 ms -> ~250 ms
-- (scoreboard_churn_summary / Board 7 -> ~17 ms), identical output. See memory
-- project_churn_retention_leadsource "TIMEOUT FIX (July 27, 2026)".
--
-- On the tiny (<2k-row) clients/leads tables a plain CREATE INDEX build is instantaneous; on a large
-- busy table run each one as CREATE INDEX CONCURRENTLY instead (cannot run inside a transaction).

create index if not exists idx_clients_company_lower_email
  on public.clients (company_id, lower(email));

create index if not exists idx_clients_company_phone_digits
  on public.clients (company_id, (regexp_replace(coalesce(phone,''), '\D', '', 'g')));

create index if not exists idx_leads_company_lower_email
  on public.leads (company_id, lower(email));

create index if not exists idx_leads_company_phone_digits
  on public.leads (company_id, (regexp_replace(coalesce(phone,''), '\D', '', 'g')));

create index if not exists idx_leads_company_fullname
  on public.leads (company_id, (lower(btrim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')))));
