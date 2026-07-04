// Lightweight in-memory sliding-window rate limiter — no external dependency.
//
// It keeps, per key, the timestamps of recent allowed events and prunes them on
// each check. This is enough to cap abuse from a leaked API token on our
// single-process PM2 deploy; counters are per-process and reset on restart
// (fail-open), which is acceptable for a guardrail — not a billing meter. It is
// NOT a distributed/durable limiter: if we ever run multiple app instances, move
// this to a shared store (Redis/DB).

type Bucket = { hits: number[] }

const buckets = new Map<string, Bucket>()
let lastSweep = 0

export type RateResult = { ok: true } | { ok: false; retryAfter: number }

/**
 * Allow at most `limit` events per `windowMs` for `key`. On rejection, returns
 * the seconds until the oldest in-window hit ages out (for a Retry-After header).
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now()
  maybeSweep(now)

  const cutoff = now - windowMs
  const bucket = buckets.get(key) ?? { hits: [] }
  const hits = bucket.hits.filter((t) => t > cutoff)

  if (hits.length >= limit) {
    bucket.hits = hits
    buckets.set(key, bucket)
    const retryAfter = Math.ceil((hits[0] + windowMs - now) / 1000)
    return { ok: false, retryAfter: Math.max(retryAfter, 1) }
  }

  hits.push(now)
  bucket.hits = hits
  buckets.set(key, bucket)
  return { ok: true }
}

// Occasionally drop buckets whose newest hit is over an hour old, so a long tail
// of one-off keys can't grow the Map without bound. Runs at most once a minute.
function maybeSweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  const stale = now - 3_600_000
  for (const [key, b] of buckets) {
    if (!b.hits.length || b.hits[b.hits.length - 1] < stale) buckets.delete(key)
  }
}
