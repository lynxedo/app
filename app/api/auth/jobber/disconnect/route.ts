import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/auth/jobber/disconnect
 * Deletes the user's Jobber token row. Next call to anything that needs
 * Jobber access (load visits, optimize, send to Jobber) will fail until
 * the user re-connects via /api/auth/jobber.
 *
 * Note: Jobber doesn't expose a token revocation endpoint in their public
 * API. Deleting our copy of the token is the only thing we can do here —
 * the OAuth grant on Jobber's side technically still exists but is unusable
 * without our refresh token. Reconnecting issues a fresh grant.
 */
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('jobber_tokens')
    .delete()
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
