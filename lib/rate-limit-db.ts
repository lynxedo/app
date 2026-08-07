// Durable rate limiting for the OAuth endpoints.
//
// lib/rate-limit.ts counts in a per-process Map that resets on deploy. That is
// fine for the extension endpoints it was written for — a leaked API token gets
// a fresh budget after a release, and the blast radius is one user's data. It is
// not fine for /api/oauth/*, which mints credentials: "deploy clears the limits"
// is a reset an attacker can time, and PM2 running more than one instance would
// silently multiply every threshold.
//
// This counts in Postgres instead: one atomic upsert per check against a fixed
// window (see supabase/2026-08-07_oauth_hardening.sql).
//
// ⚠ Fails OPEN. If the DB is unreachable the request is allowed through — but
// every caller of this is an endpoint that needs the same database one line
// later to do anything at all, so a "fail closed" here would only trade a
// clear downstream error for a confusing 429 during an outage.

import { createAdminClient } from '@/lib/supabase/admin'

export type RateResult = { ok: true } | { ok: false; retryAfter: number }

/**
 * Allow at most `limit` hits per `windowSeconds` for `key`, counted durably.
 * On rejection, `retryAfter` is the seconds remaining in the current window.
 */
export async function rateLimitDb(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateResult> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('mcp_rate_limit_hit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    })
    if (error) return { ok: true }

    // The RPC returns a one-row set; PostgREST hands it back as an array.
    const row = (Array.isArray(data) ? data[0] : data) as
      | { allowed?: boolean; retry_after?: number }
      | null
      | undefined
    if (!row || row.allowed !== false) return { ok: true }

    return { ok: false, retryAfter: Math.max(1, Number(row.retry_after) || 1) }
  } catch {
    return { ok: true }
  }
}
