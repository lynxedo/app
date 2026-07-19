import { NextRequest, NextResponse } from 'next/server'
import { encrypt, exchangeAuthCode, QBO_FALLBACK_COMPANY_ID } from '@/lib/qbo'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const realmId = searchParams.get('realmId')
  const state = searchParams.get('state')
  const expectedState = request.cookies.get('qbo_oauth_state')?.value

  if (!code || !realmId) {
    return NextResponse.json({ error: 'Missing code or realmId' }, { status: 400 })
  }

  if (!state || !expectedState || state !== expectedState) {
    return NextResponse.json({ error: 'Invalid state parameter' }, { status: 400 })
  }

  // Which tenant initiated this connect? The company_id was encoded into `state`
  // at kickoff as `${random}.${companyId}` and is integrity-protected by the
  // exact-equality check against the cookie above (a tampered value would fail
  // that check). Fall back to Heroes for any legacy/malformed state so we still
  // write a company_id on the row.
  const companyId = state.split('.').slice(1).join('.') || QBO_FALLBACK_COMPANY_ID

  let tokens: { access_token: string; refresh_token: string; expires_in: number }
  try {
    tokens = await exchangeAuthCode(code)
  } catch {
    return NextResponse.json({ error: 'Token exchange failed' }, { status: 500 })
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  const supabase = createAdminClient()
  // One QBO connection per company: upsert on company_id so re-connecting a
  // company (even to a different realm) updates its single row rather than
  // creating a second. Requires UNIQUE(company_id) — see the 2026-07-19
  // qbo_tokens company-scope migration.
  const { error } = await supabase.from('qbo_tokens').upsert(
    {
      company_id: companyId,
      realm_id: realmId,
      access_token: encrypt(tokens.access_token),
      refresh_token: encrypt(tokens.refresh_token),
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id' }
  )

  if (error) {
    console.error('Failed to save QBO tokens', error)
    return NextResponse.json({ error: 'Failed to save tokens' }, { status: 500 })
  }

  const redirect = NextResponse.redirect(new URL('/books', process.env.NEXT_PUBLIC_APP_URL!))
  redirect.cookies.delete('qbo_oauth_state')
  return redirect
}
