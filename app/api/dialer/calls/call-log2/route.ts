import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/dialer/calls/call-log2
// Returns calls with their call_ai_results rows for the /hub/call-log2 compare page.
// Requires can_access_call_log2 (or can_admin_dialer / role=admin for managers).
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

  const admin = createAdminClient()

  const { data: calls, error } = await admin
    .from('calls')
    .select(
      'id, direction, from_number, to_number, status, duration_seconds, created_at, answered_at, ended_at, recording_url, recording_storage_path, recording_duration_seconds, transcription_status, transcript, ai_summary, sentiment, call_type, topics, intents, action_items, handled_by, initiated_by, contact:txt_contacts!contact_id(id, name, phone)'
    )
    .eq('company_id', profile.company_id || '')
    .not('recording_storage_path', 'is', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch call_ai_results for the returned calls in one query.
  const callIds = (calls ?? []).map(c => c.id)
  let aiResults: {
    call_id: string
    engine: string
    transcript_text: string | null
    transcript_json: unknown
    summary: string | null
    sentiment: string | null
    sentiment_json: unknown
    topics: string[] | null
    intents: unknown
    action_items: string[] | null
    call_type: string | null
    latency_ms: number | null
    error_message: string | null
    created_at: string
  }[] = []

  if (callIds.length > 0) {
    const { data: results } = await admin
      .from('call_ai_results')
      .select('call_id, engine, transcript_text, transcript_json, summary, sentiment, sentiment_json, topics, intents, action_items, call_type, latency_ms, error_message, created_at')
      .in('call_id', callIds)
    aiResults = results ?? []
  }

  // Group ai_results by call_id
  const resultsByCallId = aiResults.reduce<Record<string, typeof aiResults>>((acc, r) => {
    if (!acc[r.call_id]) acc[r.call_id] = []
    acc[r.call_id].push(r)
    return acc
  }, {})

  const enriched = (calls ?? []).map(c => ({
    ...c,
    ai_results: resultsByCallId[c.id] ?? [],
  }))

  return NextResponse.json({ calls: enriched })
}
