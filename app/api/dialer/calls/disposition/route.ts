import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveRecentCallId } from '@/lib/dialer-active-call'

const HEROES_COMPANY_ID = process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// POST /api/dialer/calls/disposition
// Body: { disposition: string, room?: string }
// Logs the after-call outcome onto the most recent call row for this user
// (surfaced in call-log2). Never errors when there's no resolvable call — the
// disposition prompt is best-effort.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_dialer, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_dialer) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const disposition = typeof body.disposition === 'string' ? body.disposition.trim().slice(0, 60) : ''
  if (!disposition) return NextResponse.json({ error: 'disposition required' }, { status: 400 })

  const companyId = profile.company_id || HEROES_COMPANY_ID
  const callId = await resolveRecentCallId({
    bodyRoom: typeof body.room === 'string' ? body.room : undefined,
    userId: user.id,
    companyId,
  })
  if (!callId) return NextResponse.json({ ok: true, callId: null })

  const admin = createAdminClient()
  const { error } = await admin
    .from('calls')
    .update({ disposition, disposition_at: new Date().toISOString() })
    .eq('id', callId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, callId })
}
