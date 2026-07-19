import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'
import { requireAdminArea } from '@/lib/admin-auth'
import { buildGoogleAuthUrl, googleOAuthConfigured } from '@/lib/google-oauth'
import { CROSS_SUBDOMAIN_COOKIE_DOMAIN } from '@/lib/tenant-host'

export const dynamic = 'force-dynamic'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

// GET /api/auth/google — start the Google (Ads + Local Services) OAuth connect.
// Gated to the Integrations admin. Sets a short-lived CSRF state cookie, then
// redirects to Google's consent screen. Google returns to the callback route.
export async function GET() {
  const check = await requireAdminArea('integrations')
  if (!check.ok) {
    return NextResponse.redirect(`${APP_URL}/hub/home`)
  }
  if (!googleOAuthConfigured()) {
    // The platform OAuth client isn't wired yet — don't bounce the user into a
    // broken Google screen; send them back with a clear reason.
    return NextResponse.redirect(`${APP_URL}/hub/admin/integrations?google=not_configured`)
  }

  const state = randomBytes(16).toString('hex')
  const cookieStore = await cookies()
  cookieStore.set('google_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // sent on the top-level GET redirect back from Google
    maxAge: 600,
    path: '/',
    // Share across *.lynxedo.com so the state survives the subdomain→apex callback hop.
    ...(CROSS_SUBDOMAIN_COOKIE_DOMAIN ? { domain: CROSS_SUBDOMAIN_COOKIE_DOMAIN } : {}),
  })

  return NextResponse.redirect(buildGoogleAuthUrl(state))
}
