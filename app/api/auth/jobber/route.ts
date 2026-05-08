import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'

const JOBBER_CLIENT_ID = process.env.JOBBER_CLIENT_ID!
const JOBBER_AUTH_URL = 'https://api.getjobber.com/api/oauth/authorize'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

export async function GET() {
  // Verify user is logged in
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${APP_URL}/login`)
  }

  // Generate CSRF state token
  const state = randomBytes(16).toString('hex')

  // Store state in cookie (10 min)
  const cookieStore = await cookies()
  cookieStore.set('jobber_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
  })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: JOBBER_CLIENT_ID,
    redirect_uri: `${APP_URL}/api/auth/jobber/callback`,
    state,
    scope: 'read_clients write_clients read_jobs write_jobs read_visits write_visits read_users',
  })

  return NextResponse.redirect(`${JOBBER_AUTH_URL}?${params}`)
}
