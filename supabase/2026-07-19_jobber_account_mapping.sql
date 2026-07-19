-- ─────────────────────────────────────────────────────────────────────────────
-- Multi-tenant Track 3 — Jobber account → company mapping
-- 2026-07-19
--
-- PURPOSE
--   Today the Jobber webhook route hardcodes Heroes' company_id for every
--   incoming event. To route events to the correct tenant we need a lookup
--   from the Jobber account (the `accountId` Jobber puts on each webhook) to a
--   Lynxedo company. This migration adds an `account_id` column to
--   `jobber_tokens` so each connected admin's token row records which Jobber
--   account it belongs to. The webhook resolver then maps
--   webhook.accountId → jobber_tokens.account_id → company_id.
--
-- SAFETY
--   Additive and non-destructive. `account_id` is NULLABLE, so existing rows
--   are untouched and every current code path keeps working. Heroes stays on
--   the hardcoded fallback in the webhook route until its real accountId is
--   backfilled (see the placeholder UPDATE at the bottom). Nothing here changes
--   behavior on its own — it only enables the new resolver.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Additive column: which Jobber account this token belongs to.
--    Captured at OAuth going forward (see app/api/auth/jobber/callback/route.ts).
ALTER TABLE public.jobber_tokens
  ADD COLUMN IF NOT EXISTS account_id text;

-- 2) Index for the webhook resolver's lookup (WHERE account_id = $1).
CREATE INDEX IF NOT EXISTS jobber_tokens_account_id_idx
  ON public.jobber_tokens USING btree (account_id);

-- 3) Backfill Heroes' existing token row(s) with the real Jobber accountId.
--    ⚠ PLACEHOLDER — DO NOT RUN AS-IS.
--    The orchestrator must first capture Heroes' real Jobber accountId from a
--    live webhook (the route logs it via the TEMP console.log line:
--    `[jobber-webhook] accountId= ...`), then confirm whether Jobber sends it
--    base64-encoded or as a plain numeric id, and whether that matches the
--    format returned by the GraphQL `{ account { id } }` query the OAuth
--    callback stores. Replace <HEROES_JOBBER_ACCOUNT_ID> with the exact string
--    the webhook delivers (that is the value the resolver compares against),
--    then run just this statement.
--
-- UPDATE public.jobber_tokens
--   SET account_id = '<HEROES_JOBBER_ACCOUNT_ID>'
--   WHERE company_id = '00000000-0000-0000-0000-000000000002'
--     AND account_id IS NULL;
