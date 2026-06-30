import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Permission gate: recordings + transcripts are customer-sensitive. Require
  // the Call Log grant (or admin) — mirrors the call-log UI's own gating.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_call_log, role, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_call_log && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Coaching is gated separately (manager-only) — read via admin (untyped) to
  // avoid a generated-types dependency on the new column.
  const admin = createAdminClient()
  const { data: coachPerm } = await admin
    .from('user_profiles')
    .select('can_access_coaching')
    .eq('id', user.id)
    .single()
  const canViewCoaching = coachPerm?.can_access_coaching === true || profile.role === 'admin'

  const { searchParams } = new URL(request.url)
  const dateFrom = searchParams.get('date_from')
  const dateTo = searchParams.get('date_to')
  const phone = searchParams.get('phone')
  const name = searchParams.get('name')
  const keyword = searchParams.get('keyword')
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200)
  const offset = parseInt(searchParams.get('offset') || '0', 10)

  let query = supabase
    .from('call_logs')
    .select('id,recording_id,filename,call_datetime,date,direction,phone,duration_seconds,rep_name,customer_name,call_type,call_subject,customer_summary,action_items,avg_confidence,transcript_text,sentiment,sentiment_json,transcript_speakers')
    .eq('company_id', profile.company_id || '')
    .order('call_datetime', { ascending: false })
    .range(offset, offset + limit - 1)

  if (dateFrom) query = query.gte('date', dateFrom)
  if (dateTo) query = query.lte('date', dateTo)
  if (phone) {
    const digitsOnly = phone.replace(/\D/g, '')
    if (digitsOnly) query = query.ilike('phone', `%${digitsOnly}%`)
  }
  if (name) query = query.or(`customer_name.ilike.%${name}%,rep_name.ilike.%${name}%`)
  if (keyword) query = query.ilike('transcript_text', `%${keyword}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = data ?? []
  let calls: Record<string, unknown>[] = rows
  // Attach coaching (manager-only) as a second admin read, leaving the typed
  // base query untouched by the coaching columns.
  if (canViewCoaching && rows.length > 0) {
    const ids = rows.map(r => (r as { id: string }).id)
    const { data: coaching } = await admin
      .from('call_logs')
      .select('id, overall_grade, must_listen, coaching_json')
      .in('id', ids)
    const byId: Record<string, { overall_grade: string | null; must_listen: boolean | null; coaching_json: unknown }> = {}
    for (const r of coaching ?? []) {
      const row = r as { id: string; overall_grade: string | null; must_listen: boolean | null; coaching_json: unknown }
      byId[row.id] = row
    }
    calls = rows.map(r => {
      const row = r as Record<string, unknown> & { id: string }
      return {
        ...row,
        coaching_grade: byId[row.id]?.overall_grade ?? null,
        coaching_must_listen: byId[row.id]?.must_listen ?? null,
        coaching_json: byId[row.id]?.coaching_json ?? null,
      }
    })
  }
  return NextResponse.json({ calls, can_view_coaching: canViewCoaching })
}
