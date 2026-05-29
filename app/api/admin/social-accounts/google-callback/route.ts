import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  exchangeCodeForRefreshToken,
  fetchFirstAccountAndLocation,
} from '@/lib/google-business'

// GET /api/admin/social-accounts/google-callback?code=...
// Google OAuth callback — runs in browser context so Supabase session cookies are available.
export async function GET(request: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lynxedo.com'
  const adminPath = `${appUrl}/hub/admin/marketing`

  function redirectTo(path: string) {
    return NextResponse.redirect(new URL(path, appUrl))
  }

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const errorParam = url.searchParams.get('error')

  if (errorParam || !code) {
    const reason = url.searchParams.get('error_description') ?? errorParam ?? 'cancelled'
    return redirectTo(`${adminPath}?google_error=${encodeURIComponent(reason)}`)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirectTo('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_admin_marketing')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id || (profile.role !== 'admin' && !profile.can_admin_marketing)) {
    return redirectTo(`${adminPath}?google_error=forbidden`)
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return redirectTo(`${adminPath}?google_error=not_configured`)
  }

  const callbackUrl = `${appUrl}/api/admin/social-accounts/google-callback`

  // Exchange code for refresh token (long-lived) + first access token (~1h)
  const tokenResult = await exchangeCodeForRefreshToken({ code, clientId, clientSecret, callbackUrl })
  if ('error' in tokenResult) {
    return redirectTo(`${adminPath}?google_error=${encodeURIComponent(tokenResult.error)}`)
  }

  // Fetch first account + first location
  const acctLoc = await fetchFirstAccountAndLocation(tokenResult.accessToken)
  if ('error' in acctLoc) {
    return redirectTo(`${adminPath}?google_error=${encodeURIComponent(acctLoc.error)}`)
  }

  const admin = createAdminClient()
  // external_id stores both ids joined so the deliver route can split them.
  const externalId = `${acctLoc.accountId}/${acctLoc.locationId}`

  const { error } = await admin
    .from('social_accounts')
    .upsert(
      {
        company_id: profile.company_id,
        platform: 'google_business',
        account_name: acctLoc.locationTitle,
        external_id: externalId,
        access_token: tokenResult.refreshToken, // refresh token stored here; access token is short-lived and fetched at publish time
        user_token: null,
        token_expires_at: null, // refresh tokens don't expire in normal use
        ig_user_id: null,
        active: true,
      },
      { onConflict: 'company_id,platform,external_id', ignoreDuplicates: false }
    )

  if (error) {
    return redirectTo(`${adminPath}?google_error=${encodeURIComponent(error.message)}`)
  }

  return redirectTo(`${adminPath}?google_connected=1`)
}
