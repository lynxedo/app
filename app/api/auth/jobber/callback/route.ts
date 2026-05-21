import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

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

  // Store tokens in Supabase (upsert so reconnect works)
  const { error: dbError } = await supabase
    .from('jobber_tokens')
    .upsert(
      {
        user_id: user.id,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )

  if (dbError) {
    console.error('Failed to store Jobber tokens:', dbError)
    return NextResponse.redirect(`${APP_URL}/hub/routing?error=db_error`)
  }

  // Clear CSRF cookie
  cookieStore.delete('jobber_oauth_state')

  return NextResponse.redirect(`${APP_URL}/hub/routing?jobber=connected`)
}
