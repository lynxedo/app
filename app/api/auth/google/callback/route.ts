import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { exchangeGoogleCode, fetchGoogleEmail } from '@/lib/google-oauth'
import { CROSS_SUBDOMAIN_COOKIE_DOMAIN } from '@/lib/tenant-host'

export const dynamic = 'force-dynamic'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const DONE = `${APP_URL}/hub/admin/integrations`

// GET /api/auth/google/callback — Google redirects here after consent.
// Verifies the CSRF state + the Integrations-admin session, exchanges the code
// for tokens, and upserts the per-company connection.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error || !code || !state) {
    return NextResponse.redirect(`${DONE}?google=denied`)
  }

  const cookieStore = await cookies()
  const storedState = cookieStore.get('google_oauth_state')?.value
  if (!storedState || storedState !== state) {
    return NextResponse.redirect(`${DONE}?google=invalid_state`)
  }
  cookieStore.set('google_oauth_state', '', {
    path: '/',
    maxAge: 0,
    ...(CROSS_SUBDOMAIN_COOKIE_DOMAIN ? { domain: CROSS_SUBDOMAIN_COOKIE_DOMAIN } : {}),
  })

  const check = await requireAdminArea('integrations')
  if (!check.ok || !check.user || !check.company_id) {
    return NextResponse.redirect(`${APP_URL}/hub/home`)
  }

  const tokens = await exchangeGoogleCode(code)
  if (!tokens.access_token || !tokens.refresh_token) {
    // No refresh_token usually means Google didn't re-prompt for consent. We
    // force prompt=consent on connect, so this should be rare; leave any
    // existing connection untouched and report the error.
    console.error(
      '[google] token exchange incomplete:',
      tokens.error ?? '', tokens.error_description ?? '',
      'has_refresh=', Boolean(tokens.refresh_token),
    )
    return NextResponse.redirect(`${DONE}?google=token_error`)
  }

  const email = await fetchGoogleEmail(tokens.access_token)
  const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600

  const admin = createAdminClient()
  const { error: dbErr } = await admin.from('google_connections').upsert(
    {
      company_id: check.company_id,
      google_email: email,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scope: tokens.scope ?? null,
      connected_by: check.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id' },
  )
  if (dbErr) {
    console.error('[google] failed to store connection:', dbErr.message)
    return NextResponse.redirect(`${DONE}?google=db_error`)
  }

  return NextResponse.redirect(`${DONE}?google=connected`)
}
