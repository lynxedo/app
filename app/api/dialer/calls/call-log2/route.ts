import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_RECEPTIONIST_NAME } from '@/lib/voice-receptionist'

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
  const keyword = searchParams.get('keyword') || ''

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
  // Manager-only: gated on can_access_coaching ALONE — admins do NOT bypass.
  const canViewCoaching = coachPerm?.can_access_coaching === true

  let q = admin
    .from('calls')
    .select(
      'id, direction, from_number, to_number, status, duration_seconds, created_at, answered_at, ended_at, recording_storage_path, recording_duration_seconds, transcription_status, transcript, ai_summary, sentiment, call_type, topics, action_items, coaching_grade, coaching_must_listen, coaching_json, handled_by, initiated_by, transferred_to_user_id, contact:txt_contacts!contact_id(id, name, phone)'
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
  if (keyword) q = q.ilike('transcript', `%${keyword}%`)

  const { data: calls, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const callIds = (calls ?? []).map(c => c.id)
  let aiResults: {
    call_id: string; engine: string; transcript_text: string | null
    summary: string | null; sentiment: string | null; sentiment_json: unknown
    topics: string[] | null; intents: unknown; action_items: string[] | null
    call_type: string | null; avg_confidence: number | null; latency_ms: number | null; error_message: string | null
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
        .select('call_id, engine, transcript_text, summary, sentiment, sentiment_json, topics, intents, action_items, call_type, avg_confidence, latency_ms, error_message')
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

  // Resolve the agent (who handled an inbound / made an outbound call) to a name.
  const userIds = Array.from(
    new Set((calls ?? []).flatMap(c => [c.handled_by, c.initiated_by, c.transferred_to_user_id]).filter((v): v is string => !!v))
  )
  const nameById: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: users } = await admin.from('hub_users').select('id, display_name').in('id', userIds)
    for (const u of users ?? []) {
      const row = u as { id: string; display_name: string | null }
      if (row.display_name) nameById[row.id] = row.display_name
    }
  }
  // AI-receptionist ("Amber") calls are answered by the AI, not the routed human,
  // so attribute them to the configured receptionist persona instead of handled_by
  // (the inbound webhook stamps handled_by with the human route user before the call
  // is ever handed to Amber). call_type='ai_receptionist' is the durable marker:
  // ConversationRelay calls are never recorded/transcribed, so the coaching pipeline
  // never overwrites it. Resolved once — this route is single-company scoped.
  let receptionistName = ''
  if ((calls ?? []).some(c => c.call_type === 'ai_receptionist')) {
    const { data: vr } = await admin
      .from('voice_receptionist_settings')
      .select('receptionist_name')
      .eq('company_id', companyId)
      .maybeSingle()
    receptionistName =
      (vr as { receptionist_name?: string | null } | null)?.receptionist_name?.trim() ||
      DEFAULT_RECEPTIONIST_NAME
  }
  const agentName = (c: { direction?: string | null; handled_by?: string | null; initiated_by?: string | null; call_type?: string | null; transferred_to_user_id?: string | null }) => {
    if (c.call_type === 'ai_receptionist') {
      // Amber handed the call to a live person who actually took it → show them
      // (the "via Amber" tag is added client-side from ai_routed_by).
      if (c.transferred_to_user_id && nameById[c.transferred_to_user_id]) return nameById[c.transferred_to_user_id]
      return receptionistName || null
    }
    const id = (c.direction === 'inbound' ? c.handled_by : c.initiated_by) || c.handled_by || c.initiated_by
    return id ? nameById[id] ?? null : null
  }
  // Non-null only when Amber fielded the call AND a named human took the transfer,
  // so the client can render "{human} · via {receptionist}".
  const aiRoutedBy = (c: { call_type?: string | null; transferred_to_user_id?: string | null }) =>
    c.call_type === 'ai_receptionist' && c.transferred_to_user_id && nameById[c.transferred_to_user_id]
      ? receptionistName || null
      : null

  const enriched = (calls ?? []).map(c => {
    const base = {
      ...c,
      agent_name: agentName(c),
      ai_routed_by: aiRoutedBy(c),
      ai_results: aiByCallId[c.id] ?? [],
      voicemail: vmByCallId[c.id] ?? null,
    }
    // Strip coaching for users without the dedicated permission.
    if (!canViewCoaching) {
      return { ...base, coaching_grade: null, coaching_must_listen: null, coaching_json: null }
    }
    return base
  })

  // Attach the manager's review (override grade + notes + reviewed flag); the
  // override takes precedence for the displayed grade.
  let withReviews: Record<string, unknown>[] = enriched as Record<string, unknown>[]
  if (canViewCoaching && callIds.length > 0) {
    const { data: reviews } = await admin
      .from('call_coaching_reviews')
      .select('call_id, override_grade, manager_notes, acknowledged, reviewed_at')
      .eq('call_source', 'dialer')
      // Reviews are private per reviewer — only this manager's own review.
      .eq('reviewed_by', user.id)
      .in('call_id', callIds)
    const rByCall: Record<string, { override_grade: string | null; manager_notes: string | null; acknowledged: boolean }> = {}
    for (const r of reviews ?? []) {
      const row = r as { call_id: string; override_grade: string | null; manager_notes: string | null; acknowledged: boolean }
      rByCall[row.call_id] = row
    }
    withReviews = (enriched as Record<string, unknown>[]).map(c => {
      const review = rByCall[(c as { id: string }).id] ?? null
      return {
        ...c,
        review,
        coaching_grade: review?.override_grade ?? (c as { coaching_grade?: string | null }).coaching_grade ?? null,
      }
    })
  }

  // company_id lets the client subscribe to the `call-log2:{companyId}`
  // realtime broadcast (fired when a transcription completes) for live updates.
  return NextResponse.json({ calls: withReviews, company_id: companyId, can_view_coaching: canViewCoaching })
}
