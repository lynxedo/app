-- 2026-06-14 — Production incident fix (applied LIVE via Supabase SQL Editor during outage).
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query). Idempotent — safe to re-run.
--
-- CONTEXT: prod went fully down (REST 503s, auth /user 930s+, statement timeouts looping every
-- 45-90s, DB refusing new connections). Root cause = free-tier compute Disk-IO-budget death spiral,
-- amplified by (a) missing company_id indexes -> full table scans in every RLS check, and
-- (b) 11 RLS policies still calling auth.uid()/auth.role() directly (re-evaluated per row).
-- Compute was upgraded free -> Pro mid-incident (IO baseline 5 -> 11 MB/s). This file documents the
-- two SQL changes so the repo's history matches the live DB and they can be replayed on a fresh
-- DB / preview branch.
--
-- NOTE: db/schema.sql (pg_dump snapshot) and db/rls_policies.sql already drift from live — the prior
-- 135-policy auth.uid() wrapping was never back-ported into rls_policies.sql either. This standalone
-- file is the authoritative record of the Jun-14 changes; treat live DB as source of truth.

-- ---------------------------------------------------------------------------
-- STEP 1 — company_id indexes on the 8 core mirror tables.
-- (Applied as plain CREATE INDEX during the incident because the app was stopped = zero writes.
--  On a LIVE/busy DB instead run each one separately as CREATE INDEX CONCURRENTLY to avoid a
--  write lock — CONCURRENTLY cannot run inside a multi-statement transaction.)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_jobs_company_id         ON public.jobs         (company_id);
CREATE INDEX IF NOT EXISTS idx_visits_company_id       ON public.visits       (company_id);
CREATE INDEX IF NOT EXISTS idx_line_items_company_id   ON public.line_items   (company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_company_id     ON public.invoices     (company_id);
CREATE INDEX IF NOT EXISTS idx_properties_company_id   ON public.properties   (company_id);
CREATE INDEX IF NOT EXISTS idx_client_notes_company_id ON public.client_notes (company_id);
CREATE INDEX IF NOT EXISTS idx_job_notes_company_id    ON public.job_notes    (company_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_company_id     ON public.sync_log     (company_id);

-- ---------------------------------------------------------------------------
-- STEP 2 — wrap auth.uid()/auth.role() in (select ...) on the 11 policies missed by the prior pass.
-- Reads each policy's CURRENT definition and only swaps the function calls, so it cannot change
-- access logic. Guarded against double-wrapping; skips anything already fixed or absent.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r        record;
  new_qual text;
  new_chk  text;
  stmt     text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('clients',     'clients_admin_all'),
      ('contacts',    'contacts_admin_all'),
      ('properties',  'properties_admin_all'),
      ('jobs',        'jobs_admin_all'),
      ('visits',      'visits_admin_all'),
      ('invoices',    'invoices_admin_all'),
      ('line_items',  'line_items_admin_all'),
      ('client_notes','client_notes_admin'),
      ('job_notes',   'job_notes_admin'),
      ('tags',        'tags_admin'),
      ('client_tags', 'client_tags_admin')
    ) AS t(tbl, pol)
  LOOP
    SELECT qual, with_check INTO new_qual, new_chk
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = r.tbl AND policyname = r.pol;

    IF NOT FOUND THEN
      RAISE NOTICE 'SKIP (not found): % on %', r.pol, r.tbl;
      CONTINUE;
    END IF;

    IF new_qual IS NOT NULL AND position('select auth.uid()' in lower(new_qual)) = 0 THEN
      new_qual := replace(new_qual, 'auth.uid()',  '(select auth.uid())');
      new_qual := replace(new_qual, 'auth.role()', '(select auth.role())');
    END IF;
    IF new_chk IS NOT NULL AND position('select auth.uid()' in lower(new_chk)) = 0 THEN
      new_chk := replace(new_chk, 'auth.uid()',  '(select auth.uid())');
      new_chk := replace(new_chk, 'auth.role()', '(select auth.role())');
    END IF;

    stmt := format('ALTER POLICY %I ON public.%I', r.pol, r.tbl);
    IF new_qual IS NOT NULL THEN stmt := stmt || format(' USING (%s)',      new_qual); END IF;
    IF new_chk  IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', new_chk);  END IF;

    EXECUTE stmt;
    RAISE NOTICE 'UPDATED: % on %', r.pol, r.tbl;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- VERIFY (expect: target_indexes_present = 8, policies_found = 11, policies_still_bare = 0)
-- ---------------------------------------------------------------------------
-- select
--   (select count(*) from pg_indexes where schemaname='public' and indexname in
--      ('idx_jobs_company_id','idx_visits_company_id','idx_line_items_company_id',
--       'idx_invoices_company_id','idx_properties_company_id','idx_client_notes_company_id',
--       'idx_job_notes_company_id','idx_sync_log_company_id')) as target_indexes_present,
--   (select count(*) from pg_policies where schemaname='public' and policyname in
--      ('clients_admin_all','contacts_admin_all','properties_admin_all','jobs_admin_all',
--       'visits_admin_all','invoices_admin_all','line_items_admin_all','client_notes_admin',
--       'job_notes_admin','tags_admin','client_tags_admin')) as policies_found,
--   (select count(*) from pg_policies where schemaname='public' and policyname in
--      ('clients_admin_all','contacts_admin_all','properties_admin_all','jobs_admin_all',
--       'visits_admin_all','invoices_admin_all','line_items_admin_all','client_notes_admin',
--       'job_notes_admin','tags_admin','client_tags_admin')
--      and ((qual ilike '%auth.uid()%'  and qual not ilike '%select auth.uid()%')
--        or (qual ilike '%auth.role()%' and qual not ilike '%select auth.role()%')
--        or (with_check ilike '%auth.uid()%'  and with_check not ilike '%select auth.uid()%')
--        or (with_check ilike '%auth.role()%' and with_check not ilike '%select auth.role()%'))
--   ) as policies_still_bare;

-- ---------------------------------------------------------------------------
-- FOLLOW-UP (not done here): Supabase advisor flagged ~81 "multiple permissive policies"
-- (same role+action, every policy evaluated per query). Consolidate as a planned perf pass;
-- test on staging first. The DB is shared between staging and prod.
-- ---------------------------------------------------------------------------
