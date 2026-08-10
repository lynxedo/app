import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'
import { CROSS_SUBDOMAIN_COOKIE_DOMAIN } from '@/lib/tenant-host'

const JOBBER_CLIENT_ID = process.env.JOBBER_CLIENT_ID!
const JOBBER_AUTH_URL = 'https://api.getjobber.com/api/oauth/authorize'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

export async function GET() {
  // Verify user is logged in
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${APP_URL}/login`)
  }

  // ⚠ Connecting Jobber now REPLACES the company's single connection, so it has
  // to be an admin action. Before the per-company change this route was gated on
  // "logged in" alone, which was survivable only because a stray connect merely
  // added another row. Now an employee authorizing their own Jobber account would
  // repoint the whole company — including account_id, which webhook routing keys
  // off. Matches the gate already on disconnect.
  const { ok } = await requireAdminArea('integrations')
  if (!ok) {
    return NextResponse.redirect(`${APP_URL}/hub?error=jobber_connect_forbidden`)
  }

  // Generate CSRF state token
  const state = randomBytes(16).toString('hex')

  // Store state in cookie (10 min)
  const cookieStore = await cookies()
  cookieStore.set('jobber_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // sent on the top-level GET redirect back from Jobber
    maxAge: 600,
    path: '/',
    // Share across *.lynxedo.com so the state survives when the connect starts on
    // {slug}.lynxedo.com but Jobber returns to the apex callback (undefined = host-only).
    ...(CROSS_SUBDOMAIN_COOKIE_DOMAIN ? { domain: CROSS_SUBDOMAIN_COOKIE_DOMAIN } : {}),
  })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: JOBBER_CLIENT_ID,
    redirect_uri: `${APP_URL}/api/auth/jobber/callback`,
    state,
    scope: 'read_clients write_clients read_jobs write_jobs read_visits write_visits read_users',
  })

  return NextResponse.redirect(`${JOBBER_AUTH_URL}?${params}`)
}
