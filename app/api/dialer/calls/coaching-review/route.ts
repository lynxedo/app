import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Manager coaching overrides. POST upserts the review for one call, keyed by
// (call_source, call_id, reviewed_by) — reviews are PRIVATE PER REVIEWER, so
// each manager's override_grade / notes / reviewed flag are their own and don't
// clobber another manager's. The client always sends the full current state
// (override_grade, manager_notes, acknowledged), so a plain upsert is correct.
// Gated by can_access_coaching (managers) — same gate as viewing coaching.
const GRADES = new Set(['A', 'B', 'C', 'D', 'F', 'N/A'])

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('user_profiles')
    .select('can_access_coaching, role, company_id')
    .eq('id', user.id)
    .single()
  // Manager-only: gated on can_access_coaching ALONE — admins do NOT bypass.
  if (profile?.can_access_coaching !== true) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    source?: string
    callId?: string
    override_grade?: string | null
    manager_notes?: string | null
    acknowledged?: boolean
  }

  const source = body.source === 'unitel' ? 'unitel' : body.source === 'dialer' ? 'dialer' : null
  if (!source || !body.callId) {
    return NextResponse.json({ error: 'source and callId required' }, { status: 400 })
  }

  let override_grade: string | null = null
  if (typeof body.override_grade === 'string' && body.override_grade.trim()) {
    const g = body.override_grade.trim().toUpperCase()
    if (!GRADES.has(g)) return NextResponse.json({ error: 'invalid grade' }, { status: 400 })
    override_grade = g
  }

  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('call_coaching_reviews')
    .upsert(
      {
        call_source: source,
        call_id: body.callId,
        company_id: profile.company_id ?? null,
        override_grade,
        manager_notes:
          typeof body.manager_notes === 'string' ? body.manager_notes.trim() || null : null,
        acknowledged: body.acknowledged === true,
        reviewed_by: user.id,
        reviewed_at: now,
        updated_at: now,
      },
      { onConflict: 'call_source,call_id,reviewed_by' }
    )
    .select('call_source, call_id, override_grade, manager_notes, acknowledged, reviewed_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ review: data })
}
