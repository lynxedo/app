-- 2026-07-01_leads_external_lead_id.sql
-- Angi (and future GLSA) lead-webhook idempotency.
--
-- Adds a nullable external_lead_id to leads so a lead ingested from an outside
-- source (Angi's leadOid) can be deduped. Angi re-POSTs the same lead on retry,
-- so the webhook is idempotent on (company_id, external_lead_id).
-- Additive only; existing rows + the Monday mirror are unaffected (the mirror
-- never sets this column, so Monday-keyed rows keep it null).

alter table leads add column if not exists external_lead_id text;

create unique index if not exists leads_company_external_lead_uniq
  on leads (company_id, external_lead_id)
  where external_lead_id is not null;
