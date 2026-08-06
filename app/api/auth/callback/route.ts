import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { safeNextPath } from '@/lib/safe-next'
import type { EmailOtpType } from '@supabase/supabase-js'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

async function landingPathFor(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return '/hub/home'
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('landing_page')
    .eq('id', user.id)
    .single()
  return profile?.landing_page === 'dashboard' ? '/dashboard' : '/hub/home'
}

// A caller-supplied `next` wins only if it's a genuine same-site path — this is
// the redirect target of the Google/Apple sign-in round trip, so an unvalidated
// value here is an open redirect. Falls back to the user's landing page, and only
// resolves that (a DB read) when there's no usable `next`.
async function destinationFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  explicitNext: string | null,
): Promise<string> {
  return safeNextPath(explicitNext, '') || (await landingPathFor(supabase))
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const explicitNext = searchParams.get('next')

  const supabase = await createClient()

  // PKCE flow — same-browser self-service magic links
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${APP_URL}${await destinationFor(supabase, explicitNext)}`)
    }
  }

  // OTP/invite flow — invite links from /admin and cross-device magic links
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash, type })
    if (!error) {
      return NextResponse.redirect(`${APP_URL}${await destinationFor(supabase, explicitNext)}`)
    }
  }

  return NextResponse.redirect(`${APP_URL}/login?error=auth_failed`)
}
