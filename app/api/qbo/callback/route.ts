import { NextRequest, NextResponse } from 'next/server'
import { encrypt, exchangeAuthCode } from '@/lib/qbo'
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

  let tokens: { access_token: string; refresh_token: string; expires_in: number }
  try {
    tokens = await exchangeAuthCode(code)
  } catch {
    return NextResponse.json({ error: 'Token exchange failed' }, { status: 500 })
  }

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

  const redirect = NextResponse.redirect(new URL('/books', process.env.NEXT_PUBLIC_APP_URL!))
  redirect.cookies.delete('qbo_oauth_state')
  return redirect
}
