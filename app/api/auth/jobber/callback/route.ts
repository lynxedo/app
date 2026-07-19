import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { jobberGraphQL } from '@/lib/jobber'
import { CROSS_SUBDOMAIN_COOKIE_DOMAIN } from '@/lib/tenant-host'

const JOBBER_CLIENT_ID = process.env.JOBBER_CLIENT_ID!
const JOBBER_CLIENT_SECRET = process.env.JOBBER_CLIENT_SECRET!
const JOBBER_TOKEN_URL = 'https://api.getjobber.com/api/oauth/token'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  // User denied or Jobber returned an error
  if (error || !code || !state) {
    return NextResponse.redirect(`${APP_URL}/hub/routing?error=jobber_denied`)
  }

  // Verify CSRF state
  const cookieStore = await cookies()
  const storedState = cookieStore.get('jobber_oauth_state')?.value
  if (!storedState || storedState !== state) {
    return NextResponse.redirect(`${APP_URL}/hub/routing?error=invalid_state`)
  }

  // Verify user is logged in
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${APP_URL}/login`)
  }

  // Exchange code for tokens
  const tokenRes = await fetch(JOBBER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: JOBBER_CLIENT_ID,
      client_secret: JOBBER_CLIENT_SECRET,
      redirect_uri: `${APP_URL}/api/auth/jobber/callback`,
    }),
  })

  if (!tokenRes.ok) {
    const body = await tokenRes.text()
    console.error('Jobber token exchange failed:', tokenRes.status, body)
    return NextResponse.redirect(`${APP_URL}/hub/routing?error=token_exchange_failed`)
  }

  const tokens = await tokenRes.json()

  // Jobber sometimes returns 200 with an error body
  if (!tokens.access_token) {
    console.error('Jobber token exchange — no access_token in response:', JSON.stringify(tokens))
    return NextResponse.redirect(`${APP_URL}/hub/routing?error=token_exchange_failed`)
  }

  // expires_in defaults to 3600 (1 hr) if Jobber omits it
  const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

  // Resolve the connecting user's company so the token is owned by the RIGHT tenant
  // rather than the schema DEFAULT (Heroes). Critical for multi-tenant: webhook
  // routing keys off jobber_tokens.company_id (via account_id → company), so a new
  // tenant whose token defaulted to Heroes would have its Jobber events misattributed.
  const { data: connectingProfile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()

  // Store tokens in Supabase (upsert so reconnect works)
  const tokenRow: Record<string, unknown> = {
    user_id: user.id,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }
  if (connectingProfile?.company_id) tokenRow.company_id = connectingProfile.company_id
  const { error: dbError } = await supabase
    .from('jobber_tokens')
    .upsert(tokenRow, { onConflict: 'user_id' })

  if (dbError) {
    console.error('Failed to store Jobber tokens:', dbError)
    return NextResponse.redirect(`${APP_URL}/hub/routing?error=db_error`)
  }

  // Multi-tenant Track 3 — capture the Jobber accountId so the webhook route can
  // map incoming events to the right company. Best-effort: a failure here must
  // NEVER break the OAuth connect flow, so we log and continue. The token we just
  // stored is readable by jobberGraphQL (same user session).
  // ⚠ The webhook delivers accountId possibly base64-encoded; we store whatever
  // GraphQL `{ account { id } }` returns. The orchestrator MUST confirm this
  // stored format matches the webhook's `evt.accountId` before enforcement —
  // see supabase/2026-07-19_jobber_account_mapping.sql.
  try {
    const acct = await jobberGraphQL<{ data?: { account?: { id?: string } } }>(
      user.id,
      '{ account { id } }'
    )
    const accountId = acct?.data?.account?.id
    if (accountId) {
      const { error: acctErr } = await supabase
        .from('jobber_tokens')
        .update({ account_id: accountId })
        .eq('user_id', user.id)
      if (acctErr) console.error('Jobber callback: failed to store account_id:', acctErr)
    } else {
      console.warn('Jobber callback: GraphQL returned no account id, skipping account_id capture')
    }
  } catch (e) {
    console.error('Jobber callback: account_id capture failed (non-fatal):', e)
  }

  // Clear CSRF cookie
  // Clear the state cookie with the SAME domain it was set with, or the domained
  // cookie won't match and would linger (harmless — single-use, 10-min TTL — but tidy).
  cookieStore.set('jobber_oauth_state', '', {
    path: '/',
    maxAge: 0,
    ...(CROSS_SUBDOMAIN_COOKIE_DOMAIN ? { domain: CROSS_SUBDOMAIN_COOKIE_DOMAIN } : {}),
  })

  return NextResponse.redirect(`${APP_URL}/hub/routing?jobber=connected`)
}
