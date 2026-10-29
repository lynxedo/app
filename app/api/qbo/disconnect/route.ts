import { NextRequest, NextResponse } from 'next/server'
import { decrypt, revokeToken } from '@/lib/qbo'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkPinCookie } from '@/lib/check-pin-cookie'
import { requireCompany } from '@/lib/company-auth'

export async function POST(request: NextRequest) {
  const denied = await checkPinCookie(request)
  if (denied) return denied

  const origin = request.headers.get('origin')
  if (origin !== process.env.NEXT_PUBLIC_APP_URL) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Only ever revoke/delete the caller's OWN company token.
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const companyId = auth.companyId

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('qbo_tokens')
    .select('id, refresh_token')
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Not connected' }, { status: 404 })
  }

  await revokeToken(decrypt(data.refresh_token))
  await supabase.from('qbo_tokens').delete().eq('id', data.id)

  return NextResponse.json({ ok: true })
}
