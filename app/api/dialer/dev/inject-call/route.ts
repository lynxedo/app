import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/twilio-voice'

// Admin-only dev tool: synthesize a calls row end-to-end (inbound or outbound,
// any status, optional contact lookup, optional duration) so the UI can be
// exercised on staging without real Twilio traffic. Mirrors Session 46's
// /api/txt/dev/inject-inbound pattern.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_dialer, can_admin_hub, company_id')
    .eq('id', user.id)
    .single()

  const isAdmin =
    profile?.role === 'admin' || !!profile?.can_admin_dialer || !!profile?.can_admin_hub
  if (!isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    direction?: 'inbound' | 'outbound'
    from?: string
    to?: string
    status?: string
    duration_seconds?: number
  }

  const direction = body.direction === 'outbound' ? 'outbound' : 'inbound'
  const from = body.from ? (toE164(body.from) || body.from) : direction === 'inbound' ? '+12815551234' : '+18325550000'
  const to = body.to ? (toE164(body.to) || body.to) : direction === 'inbound' ? '+18325550000' : '+12815551234'
  const status = body.status || (direction === 'inbound' ? 'no-answer' : 'completed')
  const duration_seconds = body.duration_seconds ?? (status === 'completed' ? 47 : 0)

  const admin = createAdminClient()

  // Try to associate the caller's contact row when possible (the field that
  // would normally come in via the webhook).
  const lookupPhone = direction === 'inbound' ? from : to
  let contactId: string | null = null
  if (lookupPhone) {
    const { data: contact } = await admin
      .from('txt_contacts')
      .select('id')
      .eq('company_id', profile?.company_id || '')
      .eq('phone', lookupPhone)
      .maybeSingle()
    contactId = contact?.id ?? null
  }

  const { data: row, error } = await admin
    .from('calls')
    .insert({
      company_id: profile?.company_id,
      direction,
      from_number: from,
      to_number: to,
      status,
      duration_seconds,
      handled_by: direction === 'outbound' ? user.id : null,
      initiated_by: direction === 'outbound' ? user.id : null,
      contact_id: contactId,
      answered_at: status === 'completed' ? new Date().toISOString() : null,
      ended_at: ['completed', 'no-answer', 'busy', 'failed', 'canceled'].includes(status)
        ? new Date().toISOString()
        : null,
    })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, call_id: row.id })
}
