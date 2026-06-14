import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from './server'

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
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

// Full profile row for the signed-in user, memoized for the request. Selecting *
// keeps a single shared query able to satisfy every consumer (the root layout
// reads a small nav subset; the Hub layout reads a large permission set).
export const getCurrentProfile = cache(async () => {
  const user = await getCurrentUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  return data
})
