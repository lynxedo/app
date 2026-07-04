import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mintToken } from '@/lib/extension-auth'

// GET /extension/connect?redirect_uri=https://<ext-id>.chromiumapp.org/
//
// The "Sign in with Lynxedo" endpoint for the browser extension. The extension
// opens this via chrome.identity.launchWebAuthFlow. If the user is already
// logged into lynxedo.com in this browser (the common case), we mint a token
// and bounce it straight back to the extension — no copy/paste. If they're not
// logged in, we send them through /login (which returns here via ?next=), then
// mint + bounce.
//
// Security: redirect_uri MUST be a Chrome extension redirect (*.chromiumapp.org)
// so a token can never be handed to an arbitrary site. The raw token rides back
// in the URL fragment (#token=…), which browsers never send to servers or put
// in the Referer — so it stays out of logs.

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://lynxedo.com'

function isValidExtensionRedirect(uri: string): boolean {
  try {
    const u = new URL(uri)
    return u.protocol === 'https:' && u.hostname.endsWith('.chromiumapp.org')
  } catch {
    return false
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const redirectUri = url.searchParams.get('redirect_uri') || ''

  if (!isValidExtensionRedirect(redirectUri)) {
    return new NextResponse('Invalid or missing redirect_uri', { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Not logged in → go log in, then come right back here to finish.
  if (!user) {
    const selfPath = `/extension/connect?redirect_uri=${encodeURIComponent(redirectUri)}`
    return NextResponse.redirect(`${APP_URL}/login?next=${encodeURIComponent(selfPath)}`)
  }

  // Resolve the caller's company (tenant-generic; env fallback only).
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .maybeSingle()
  const companyId = (profile?.company_id as string | null) || HEROES_COMPANY_ID

  const { raw, hash, prefix } = mintToken()
  const admin = createAdminClient()
  const { error } = await admin.from('user_api_tokens').insert({
    user_id: user.id,
    company_id: companyId,
    token_hash: hash,
    token_prefix: prefix,
    label: 'Browser extension',
  })
  if (error) {
    return new NextResponse('Could not create extension token', { status: 500 })
  }

  // Hand the token back to the extension in the fragment.
  return NextResponse.redirect(`${redirectUri}#token=${encodeURIComponent(raw)}`)
}
