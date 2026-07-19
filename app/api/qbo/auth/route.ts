import { NextRequest, NextResponse } from 'next/server'
import { checkPinCookie } from '@/lib/check-pin-cookie'
import { resolveSessionCompanyId } from '@/lib/company-auth'
import { QBO_FALLBACK_COMPANY_ID } from '@/lib/qbo'
import { CROSS_SUBDOMAIN_COOKIE_DOMAIN } from '@/lib/tenant-host'

const SCOPES = 'com.intuit.quickbooks.accounting'

export async function GET(request: NextRequest) {
  const denied = await checkPinCookie(request)
  if (denied) return denied

  // Which tenant is connecting? Books runs under the Hub session, so this is a
  // real resolution (Heroes falls back to itself). We carry the company_id in
  // the OAuth `state` so the callback writes the token to the RIGHT company.
  // The company_id is integrity-protected: the callback rejects the flow unless
  // the returned `state` exactly equals the httpOnly cookie set below, so a
  // tampered company_id can't survive the round-trip. (Company UUIDs are not
  // secret; only the random half provides CSRF protection.)
  const companyId = await resolveSessionCompanyId(QBO_FALLBACK_COMPANY_ID)
  const state = `${crypto.randomUUID()}.${companyId}`
  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID!,
    response_type: 'code',
    scope: SCOPES,
    redirect_uri: process.env.QBO_REDIRECT_URI!,
    state,
  })

  const url = `https://appcenter.intuit.com/connect/oauth2?${params}`
  const response = NextResponse.redirect(url)
  response.cookies.set('qbo_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60,
    path: '/',
    // Share across *.lynxedo.com so the state survives the subdomain→apex callback hop.
    ...(CROSS_SUBDOMAIN_COOKIE_DOMAIN ? { domain: CROSS_SUBDOMAIN_COOKIE_DOMAIN } : {}),
  })
  return response
}
