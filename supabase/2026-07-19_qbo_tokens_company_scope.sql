-- ============================================================================
-- Migration: company-scope qbo_tokens  (Multi-tenant Track 3 — QuickBooks)
-- Date: 2026-07-19
--
-- ⚠️⚠️  CHANGES A CONSTRAINT ON A TABLE THAT HOLDS REAL DATA (LIVE FINANCIALS).
-- ⚠️⚠️  The orchestrator MUST show this SQL to the owner (Ben) and get an
--        explicit "confirmed" before applying. Back up first.
--
-- WHAT & WHY
--   qbo_tokens today has NO company_id, and every read is a global
--   `order by updated_at desc limit 1`. In a multi-tenant world that means
--   tenant A could fetch / refresh / revoke tenant B's QuickBooks token
--   (cross-tenant access to LIVE FINANCIALS). This migration mirrors the
--   already-company-scoped jobber_tokens model:
--     - add company_id (uuid, FK -> companies, DEFAULT Heroes UUID)
--     - backfill existing rows to the Heroes company
--     - SET NOT NULL
--     - index company_id
--     - enforce one QBO connection per company via UNIQUE(company_id)
--
-- SAFETY / BLAST RADIUS
--   - Heroes Lawn Care (company 00000000-0000-0000-0000-000000000002) is the
--     ONLY live tenant with a QBO connection. Its single existing row is
--     backfilled to its OWN UUID, so its Books dashboard keeps working
--     byte-for-byte.
--   - Additive only. No column is dropped or renamed. No token bytes change.
--
-- UNIQUE-CONSTRAINT DECISION (deliberate)
--   The existing UNIQUE(realm_id) (qbo_tokens_realm_id_key) is KEPT — a
--   QuickBooks realm (company file) should still map to exactly one row, so a
--   realm can never be double-registered across tenants. We ADD a separate
--   UNIQUE(company_id) so a tenant can hold at most one QBO connection. Both
--   already hold for Heroes' single row; neither is dropped. Tradeoff: if two
--   different tenants ever tried to connect the SAME QuickBooks realm, the
--   second connect would fail on UNIQUE(realm_id) — that is the desired
--   behavior (a realm belongs to one tenant), not a bug.
--
-- APP DEPENDENCY — SHIP THE CODE CUTOVER WITH THIS MIGRATION
--   app/api/qbo/callback/route.ts changes its upsert onConflict target from
--   'realm_id' to 'company_id' (one connection per company). getQBOToken() /
--   qboFetch() / loadPLData() / disconnect / the Books + Admin→Integrations
--   probes now all filter by company_id. The onConflict:'company_id' upsert
--   REQUIRES the UNIQUE(company_id) constraint added below, so this migration
--   must be applied together with (or just before) that code deploy.
-- ============================================================================

-- 1) Additive column with the Heroes default (mirrors jobber_tokens).
ALTER TABLE public.qbo_tokens
  ADD COLUMN IF NOT EXISTS company_id uuid
  DEFAULT '00000000-0000-0000-0000-000000000002'::uuid;

-- 2) Backfill any pre-existing rows (Heroes' live token) to the Heroes company.
UPDATE public.qbo_tokens
  SET company_id = '00000000-0000-0000-0000-000000000002'::uuid
  WHERE company_id IS NULL;

-- 3) Lock it down.
ALTER TABLE public.qbo_tokens
  ALTER COLUMN company_id SET NOT NULL;

-- 4) FK to companies (mirrors jobber_tokens_company_id_fkey).
ALTER TABLE public.qbo_tokens
  ADD CONSTRAINT qbo_tokens_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES public.companies(id);

-- 5) Index (mirrors jobber_tokens_company_id_idx).
CREATE INDEX IF NOT EXISTS qbo_tokens_company_id_idx
  ON public.qbo_tokens USING btree (company_id);

-- 6) One QBO connection per company. Additive — UNIQUE(realm_id) is KEPT.
--    This is the onConflict target for the callback upsert.
ALTER TABLE public.qbo_tokens
  ADD CONSTRAINT qbo_tokens_company_id_key UNIQUE (company_id);
