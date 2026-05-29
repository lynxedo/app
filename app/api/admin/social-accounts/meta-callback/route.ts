import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  exchangeCodeForUserToken,
  exchangeForLongLivedToken,
  fetchPagesWithIg,
} from '@/lib/meta-graph'

// GET /api/admin/social-accounts/meta-callback?code=...
// Meta OAuth callback — runs in browser context so Supabase session cookies are available.
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
    return redirectTo(`${adminPath}?meta_error=${encodeURIComponent(reason)}`)
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
    return redirectTo(`${adminPath}?meta_error=forbidden`)
  }

  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) {
    return redirectTo(`${adminPath}?meta_error=not_configured`)
  }

  const callbackUrl = `${appUrl}/api/admin/social-accounts/meta-callback`

  // Exchange code for short-lived user token
  const shortResult = await exchangeCodeForUserToken({ code, appId, appSecret, callbackUrl })
  if ('error' in shortResult) {
    return redirectTo(`${adminPath}?meta_error=${encodeURIComponent(shortResult.error)}`)
  }

  // Upgrade to long-lived token (~60 days)
  const longResult = await exchangeForLongLivedToken({ shortToken: shortResult.token, appId, appSecret })
  if ('error' in longResult) {
    return redirectTo(`${adminPath}?meta_error=${encodeURIComponent(longResult.error)}`)
  }

  // Fetch all pages the user manages, with IG Business Account IDs
  const pagesResult = await fetchPagesWithIg(longResult.token)
  if ('error' in pagesResult) {
    return redirectTo(`${adminPath}?meta_error=${encodeURIComponent(pagesResult.error)}`)
  }

  const admin = createAdminClient()
  const expiresAt = new Date(Date.now() + longResult.expiresIn * 1000).toISOString()

  // Upsert each Facebook page as a social_accounts row
  let upserted = 0
  for (const page of pagesResult) {
    const { error } = await admin
      .from('social_accounts')
      .upsert(
        {
          company_id: profile.company_id,
          platform: 'facebook',
          account_name: page.name,
          external_id: page.id,
          access_token: page.access_token,
          user_token: longResult.token,
          token_expires_at: expiresAt,
          ig_user_id: page.ig_user_id,
          active: true,
        },
        { onConflict: 'company_id,platform,external_id', ignoreDuplicates: false }
      )
    if (!error) upserted++
  }

  return redirectTo(`${adminPath}?meta_connected=${upserted}`)
}
