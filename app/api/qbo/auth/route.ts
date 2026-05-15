import { NextRequest, NextResponse } from 'next/server'
import { checkPinCookie } from '@/lib/check-pin-cookie'

const SCOPES = 'com.intuit.quickbooks.accounting'

export async function GET(request: NextRequest) {
  const denied = await checkPinCookie(request)
  if (denied) return denied

  const state = crypto.randomUUID()
  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID!,
    response_type: 'code',
    scope: SCOPES,
    redirect_uri: process.env.QBO_REDIRECT_URI!,
    state,
  })

  const url = `https://appcenter.intuit.com/connect/oauth2?${params}`
  return NextResponse.redirect(url)
}
