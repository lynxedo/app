import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from './server'

// Fail-fast guard (Phase 5, after the 2026-06-14 Supabase Auth outage). When auth
// degrades, getUser() and the profile query can hang on internal retries — and the
// root layout + Hub layout both await them on the critical render path, so the whole
// site goes unusable. We bound each call to ~2s; on timeout (or error) we resolve to
// null, which both layouts already treat as "logged out" (the body still renders, and
// the middleware redirects protected routes to /login). Pages fail fast instead of hanging.
const AUTH_TIMEOUT_MS = 2000

function withTimeout<T>(promise: PromiseLike<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value) },
      () => { clearTimeout(timer); resolve(fallback) },
    )
  })
}

// Request-scoped memoization (IN-perf). The root layout (app/layout.tsx) AND the
// Hub layout (app/hub/layout.tsx) both render in the SAME RSC request pass, and
// each used to independently call supabase.auth.getUser() (a network round-trip
// to the auth server) and query user_profiles. React's cache() collapses those
// duplicate calls to a single one per request, so a Hub page load makes one
// getUser + one profile query for both layouts instead of two of each.
//
// NOTE: the proxy/middleware runs in a separate runtime and is NOT covered by
// this memo — it keeps its own getUser + profile fetch for route gating.

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient()
  return withTimeout(
    supabase.auth.getUser().then(({ data }) => data.user),
    AUTH_TIMEOUT_MS,
    null,
  )
})

// Full profile row for the signed-in user, memoized for the request. Selecting *
// keeps a single shared query able to satisfy every consumer (the root layout
// reads a small nav subset; the Hub layout reads a large permission set).
export const getCurrentProfile = cache(async () => {
  const user = await getCurrentUser()
  if (!user) return null
  const supabase = await createClient()
  return withTimeout(
    supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single()
      .then(({ data }) => data),
    AUTH_TIMEOUT_MS,
    null,
  )
})
