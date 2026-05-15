import { NextRequest, NextResponse } from 'next/server'
import { encrypt } from '@/lib/qbo'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const realmId = searchParams.get('realmId')

  if (!code || !realmId) {
    return NextResponse.json({ error: 'Missing code or realmId' }, { status: 400 })
  }

  const credentials = Buffer.from(
    `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.QBO_REDIRECT_URI!,
    }),
    cache: 'no-store',
  })

  const intuitTid = res.headers.get('intuit_tid')

  if (!res.ok) {
    const text = await res.text()
    console.error('QBO token exchange failed', { status: res.status, intuit_tid: intuitTid, error: text })
    return NextResponse.json({ error: 'Token exchange failed' }, { status: 500 })
  }

  const tokens = await res.json()
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  const supabase = createAdminClient()
  const { error } = await supabase.from('qbo_tokens').upsert(
    {
      realm_id: realmId,
      access_token: encrypt(tokens.access_token),
      refresh_token: encrypt(tokens.refresh_token),
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'realm_id' }
  )

  if (error) {
    console.error('Failed to save QBO tokens', error)
    return NextResponse.json({ error: 'Failed to save tokens' }, { status: 500 })
  }

  return NextResponse.redirect(new URL('/books', process.env.NEXT_PUBLIC_APP_URL!))
}
