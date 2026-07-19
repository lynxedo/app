import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { requireAdminArea } from '@/lib/admin-auth'
import { GUSTO_AUTHORIZE_URL } from '@/lib/gusto'
import { CROSS_SUBDOMAIN_COOKIE_DOMAIN } from '@/lib/tenant-host'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

// Starts the one-time Gusto OAuth connect (same pattern as the Jobber connect).
export async function GET() {
  const check = await requireAdminArea('timesheet')
  if (!check.ok || !check.user) {
    return NextResponse.redirect(`${APP_URL}/hub`)
  }

  if (!process.env.GUSTO_CLIENT_ID || !process.env.GUSTO_CLIENT_SECRET) {
    return NextResponse.redirect(`${APP_URL}/hub/admin/timesheet?gusto=not_configured`)
  }

  const state = crypto.randomUUID()
  const cookieStore = await cookies()
  cookieStore.set('gusto_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
    // Share across *.lynxedo.com so the state survives the subdomain→apex callback hop.
    ...(CROSS_SUBDOMAIN_COOKIE_DOMAIN ? { domain: CROSS_SUBDOMAIN_COOKIE_DOMAIN } : {}),
  })

  const url = new URL(GUSTO_AUTHORIZE_URL)
  url.searchParams.set('client_id', process.env.GUSTO_CLIENT_ID)
  url.searchParams.set('redirect_uri', `${APP_URL}/api/admin/gusto/callback`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)

  return NextResponse.redirect(url.toString())
}
