import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { nylasExchangeCode } from '@/lib/inbox/nylas'
import { CROSS_SUBDOMAIN_COOKIE_DOMAIN } from '@/lib/tenant-host'

export const dynamic = 'force-dynamic'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

// GET /api/auth/nylas/callback — Nylas redirects here after consent.
// Verifies the CSRF state cookie, exchanges the code for a grant, and upserts the
// inbox_accounts row. The state cookie carries the type/company/user context set
// on connect (the grant id is the only per-mailbox secret we persist).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const oauthError = searchParams.get('error')

  const cookieStore = await cookies()
  const stored = cookieStore.get('nylas_oauth_state')?.value || ''
  // Clear the state cookie (same domain attrs as when set).
  cookieStore.set('nylas_oauth_state', '', {
    path: '/',
    maxAge: 0,
    ...(CROSS_SUBDOMAIN_COOKIE_DOMAIN ? { domain: CROSS_SUBDOMAIN_COOKIE_DOMAIN } : {}),
  })

  const [cookieState, cookieType, cookieCompanyId, cookieUserId] = stored.split('.')
  const type: 'shared' | 'personal' = cookieType === 'shared' ? 'shared' : 'personal'
  const donePage = type === 'shared' ? '/hub/admin/integrations' : '/hub/email'
  const failRedirect = `${APP_URL}${donePage}?error=connect_failed`

  // Validate: no provider error, code + state present, and the state matches the
  // leading segment of our cookie (CSRF), with a usable company + user.
  if (
    oauthError ||
    !code ||
    !state ||
    !cookieState ||
    cookieState !== state ||
    !cookieCompanyId ||
    !cookieUserId
  ) {
    return NextResponse.redirect(failRedirect)
  }

  try {
    const grant = await nylasExchangeCode(code)
    const admin = createAdminClient()
    const nowIso = new Date().toISOString()

    const row = {
      company_id: cookieCompanyId,
      provider: 'nylas',
      underlying_provider: grant.underlyingProvider,
      nylas_grant_id: grant.grantId,
      account_type: type,
      email_address: grant.email,
      display_name: grant.email,
      owner_user_id: type === 'personal' ? cookieUserId : null,
      status: 'connected',
      active: true,
      connected_by: cookieUserId,
      updated_at: nowIso,
    }

    // Re-auth of the SAME mailbox may return a fresh grant id. If this grant id
    // already exists (unique(nylas_grant_id)), update that row in place; otherwise
    // upsert on the mailbox identity (company_id,email_address), which refreshes
    // the grant id on the existing row rather than erroring.
    const { data: byGrant } = await admin
      .from('inbox_accounts')
      .select('id')
      .eq('nylas_grant_id', grant.grantId)
      .maybeSingle()

    if (byGrant?.id) {
      const { error } = await admin.from('inbox_accounts').update(row).eq('id', byGrant.id)
      if (error) throw error
    } else {
      const { error } = await admin
        .from('inbox_accounts')
        .upsert(row, { onConflict: 'company_id,email_address' })
      if (error) throw error
    }

    const done =
      type === 'shared'
        ? `${APP_URL}/hub/admin/integrations?connected=inbox`
        : `${APP_URL}/hub/email?connected=personal`
    return NextResponse.redirect(done)
  } catch (err) {
    console.error('[nylas:callback] connect failed:', err instanceof Error ? err.message : err)
    return NextResponse.redirect(failRedirect)
  }
}
