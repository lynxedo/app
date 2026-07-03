import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { GUSTO_TOKEN_URL, fetchGustoCompanyUuid } from '@/lib/gusto'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const BACK = `${APP_URL}/hub/admin/timesheet`

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error || !code || !state) {
    return NextResponse.redirect(`${BACK}?gusto=denied`)
  }

  const cookieStore = await cookies()
  const storedState = cookieStore.get('gusto_oauth_state')?.value
  if (!storedState || storedState !== state) {
    return NextResponse.redirect(`${BACK}?gusto=invalid_state`)
  }

  const check = await requireAdminArea('timesheet')
  if (!check.ok || !check.user || !check.company_id) {
    return NextResponse.redirect(`${APP_URL}/login`)
  }

  const tokenRes = await fetch(GUSTO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.GUSTO_CLIENT_ID ?? '',
      client_secret: process.env.GUSTO_CLIENT_SECRET ?? '',
      redirect_uri: `${APP_URL}/api/admin/gusto/callback`,
    }),
  })
  if (!tokenRes.ok) {
    console.error('Gusto token exchange failed:', tokenRes.status, await tokenRes.text().catch(() => ''))
    return NextResponse.redirect(`${BACK}?gusto=token_exchange_failed`)
  }

  const tokens = await tokenRes.json()
  if (!tokens.access_token || !tokens.refresh_token) {
    console.error('Gusto token exchange — incomplete response:', JSON.stringify(tokens))
    return NextResponse.redirect(`${BACK}?gusto=token_exchange_failed`)
  }

  const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : 7200
  const companyUuid = await fetchGustoCompanyUuid(tokens.access_token)

  const admin = createAdminClient()
  const { error: dbError } = await admin.from('gusto_connections').upsert(
    {
      company_id: check.company_id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      gusto_company_uuid: companyUuid,
      connected_by: check.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id' }
  )
  if (dbError) {
    console.error('Failed to store Gusto tokens:', dbError)
    return NextResponse.redirect(`${BACK}?gusto=db_error`)
  }

  cookieStore.delete('gusto_oauth_state')
  return NextResponse.redirect(`${BACK}?gusto=connected`)
}
