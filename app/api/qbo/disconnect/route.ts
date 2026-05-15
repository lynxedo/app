import { NextRequest, NextResponse } from 'next/server'
import { decrypt } from '@/lib/qbo'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkPinCookie } from '@/lib/check-pin-cookie'

export async function POST(request: NextRequest) {
  const denied = await checkPinCookie(request)
  if (denied) return denied

  const origin = request.headers.get('origin')
  if (origin !== process.env.NEXT_PUBLIC_APP_URL) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('qbo_tokens')
    .select('id, refresh_token')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Not connected' }, { status: 404 })
  }

  const refreshToken = decrypt(data.refresh_token)
  const credentials = Buffer.from(
    `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
  ).toString('base64')

  const revokeRes = await fetch('https://developer.api.intuit.com/v2/oauth2/tokens/revoke', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({ token: refreshToken }),
    cache: 'no-store',
  })

  const intuitTid = revokeRes.headers.get('intuit_tid')
  if (!revokeRes.ok) {
    console.error('QBO revoke failed', { status: revokeRes.status, intuit_tid: intuitTid })
  }

  await supabase.from('qbo_tokens').delete().eq('id', data.id)

  return NextResponse.json({ ok: true })
}
