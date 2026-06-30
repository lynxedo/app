import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/dialer/calls/call-log2
// Returns ALL Twilio calls (not just recorded ones), with joined voicemails and
// call_ai_results, for the /hub/call-log2 page.
// Requires can_access_call_log2 (or can_admin_dialer / role=admin).
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_call_log2, can_admin_dialer, role, company_id')
    .eq('id', user.id)
    .single()

  if (!profile?.can_access_call_log2 && profile?.role !== 'admin' && !profile?.can_admin_dialer) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500)
  const offset = parseInt(searchParams.get('offset') || '0', 10)
  const dateFrom = searchParams.get('date_from') || ''
  const dateTo = searchParams.get('date_to') || ''
  const phone = searchParams.get('phone') || ''

  const admin = createAdminClient()
  const companyId = profile.company_id || ''

  // Coaching (rep-performance) scores are gated separately from transcripts so
  // they stay manager-only. Read via the admin client (untyped) to avoid a
  // generated-types dependency on the new column.
  const { data: coachPerm } = await admin
    .from('user_profiles')
    .select('can_access_coaching')
    .eq('id', user.id)
    .single()
  const canViewCoaching = coachPerm?.can_access_coaching === true || profile.role === 'admin'

  let q = admin
    .from('calls')
    .select(
      'id, direction, from_number, to_number, status, duration_seconds, created_at, answered_at, ended_at, recording_storage_path, recording_duration_seconds, transcription_status, transcript, ai_summary, sentiment, call_type, topics, action_items, coaching_grade, coaching_must_listen, coaching_json, handled_by, initiated_by, contact:txt_contacts!contact_id(id, name, phone)'
    )
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (dateFrom) q = q.gte('created_at', `${dateFrom}T00:00:00`)
  if (dateTo) q = q.lte('created_at', `${dateTo}T23:59:59`)
  if (phone) {
    const digits = phone.replace(/\D/g, '')
    q = q.or(`from_number.ilike.%${digits}%,to_number.ilike.%${digits}%`)
  }

  const { data: calls, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const callIds = (calls ?? []).map(c => c.id)
  let aiResults: {
    call_id: string; engine: string; transcript_text: string | null
    summary: string | null; sentiment: string | null; sentiment_json: unknown
    topics: string[] | null; intents: unknown; action_items: string[] | null
    call_type: string | null; latency_ms: number | null; error_message: string | null
  }[] = []
  let voicemails: {
    id: string; call_id: string; from_number: string
    recording_storage_path: string | null; recording_duration_sec: number | null
    transcript: string | null; created_at: string
  }[] = []

  if (callIds.length > 0) {
    const [aiRes, vmRes] = await Promise.all([
      admin
        .from('call_ai_results')
        .select('call_id, engine, transcript_text, summary, sentiment, sentiment_json, topics, intents, action_items, call_type, latency_ms, error_message')
        .in('call_id', callIds),
      admin
        .from('voicemails')
        .select('id, call_id, from_number, recording_storage_path, recording_duration_sec, transcript, created_at')
        .in('call_id', callIds),
    ])
    aiResults = aiRes.data ?? []
    voicemails = vmRes.data ?? []
  }

  const aiByCallId = aiResults.reduce<Record<string, typeof aiResults>>((acc, r) => {
    if (!acc[r.call_id]) acc[r.call_id] = []
    acc[r.call_id].push(r)
    return acc
  }, {})

  const vmByCallId: Record<string, typeof voicemails[0]> = {}
  for (const vm of voicemails) vmByCallId[vm.call_id] = vm

  const enriched = (calls ?? []).map(c => {
    const base = {
      ...c,
      ai_results: aiByCallId[c.id] ?? [],
      voicemail: vmByCallId[c.id] ?? null,
    }
    // Strip coaching for users without the dedicated permission.
    if (!canViewCoaching) {
      return { ...base, coaching_grade: null, coaching_must_listen: null, coaching_json: null }
    }
    return base
  })

  // company_id lets the client subscribe to the `call-log2:{companyId}`
  // realtime broadcast (fired when a transcription completes) for live updates.
  return NextResponse.json({ calls: enriched, company_id: companyId, can_view_coaching: canViewCoaching })
}
