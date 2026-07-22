import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'
import { requireAdminArea } from '@/lib/admin-auth'
import { requireCompany } from '@/lib/company-auth'
import { nylasConfigured } from '@/lib/inbox/config'
import { nylasBuildAuthUrl } from '@/lib/inbox/nylas'
import { CROSS_SUBDOMAIN_COOKIE_DOMAIN } from '@/lib/tenant-host'

export const dynamic = 'force-dynamic'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

// GET /api/auth/nylas — start a Nylas hosted-OAuth connect for a mailbox.
//   ?type=shared    connect the company's shared inbox (hlc105) — Integrations admin only.
//   ?type=personal  connect the caller's own mailbox (default).
//   ?provider=microsoft|google  optional transport hint.
// Sets a short-lived CSRF state cookie, then redirects to Nylas' consent screen.
// Nylas returns to /api/auth/nylas/callback.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') === 'shared' ? 'shared' : 'personal'
  const providerParam = searchParams.get('provider') || undefined

  // Gate + resolve the acting user's company. The shared mailbox is an admin
  // action; a personal mailbox is any authed user connecting their own.
  let companyId: string
  let userId: string
  if (type === 'shared') {
    const check = await requireAdminArea('integrations')
    if (!check.ok || !check.company_id || !check.user) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    companyId = check.company_id
    userId = check.user.id
  } else {
    const auth = await requireCompany()
    if ('error' in auth) return auth.error
    companyId = auth.companyId
    userId = auth.userId
  }

  // Dark until Ben provisions the production Nylas app + env — don't bounce the
  // user into a broken consent screen.
  if (!nylasConfigured()) {
    const dest = type === 'shared' ? '/hub/admin/integrations' : '/hub/settings'
    return NextResponse.redirect(`${APP_URL}${dest}?error=nylas_not_configured`)
  }

  // For the known hlc105 shared mailbox default to Microsoft; a personal connect
  // omits provider so Nylas shows its provider chooser.
  const provider = type === 'shared' ? providerParam || 'microsoft' : providerParam

  const state = randomBytes(16).toString('hex')
  const cookieStore = await cookies()
  // Pack the routing context into the state cookie so the (apex) callback knows
  // what it's connecting for. state/type/companyId/userId are all dot-free
  // (hex / literal / UUID), so a plain split('.') round-trips cleanly.
  cookieStore.set('nylas_oauth_state', `${state}.${type}.${companyId}.${userId}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // sent on the top-level GET redirect back from Nylas
    maxAge: 600, // 10 minutes
    path: '/',
    // Share across *.lynxedo.com so the state survives a subdomain→apex callback hop.
    ...(CROSS_SUBDOMAIN_COOKIE_DOMAIN ? { domain: CROSS_SUBDOMAIN_COOKIE_DOMAIN } : {}),
  })

  return NextResponse.redirect(nylasBuildAuthUrl({ state, provider }))
}
