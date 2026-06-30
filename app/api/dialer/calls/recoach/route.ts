import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { claudeAnalyze, resolveRepName } from '@/lib/call-transcribe'
import { coachingHasRealScore } from '@/lib/call-rubric'

// Re-score historical dialer calls through the CURRENT coaching rubric, reusing
// each call's already-saved transcript (no re-recording / re-transcription —
// just Claude with the updated rubric). Cron-secret protected (same pattern as
// the scoreboards snapshot). POST body:
//   { callId }                -> re-score one call, returns before/after
//   { limit?, offset? }       -> batch over calls that already have a grade
//   { dryRun: true }          -> with callId, returns current values, writes nothing
export const maxDuration = 300

type Coaching = {
  overall_grade?: string
  headline?: string
  must_listen?: boolean
  must_listen_reason?: string | null
  red_flags?: unknown
  never_dos_triggered?: unknown
  wins?: unknown
  improvements?: unknown
}

// Used when a call is too short / not a real conversation (hang-up, no-answer,
// voicemail). These must never carry a letter grade — see the rubric guardrail.
const NA_COACHING = {
  overall_grade: 'N/A',
  headline: 'No scorable conversation (hang-up, no-answer, voicemail, or too short to evaluate).',
  categories: {},
  industry_knowledge_issues: [],
  wins: [],
  improvements: [],
  red_flags: [],
  never_dos_triggered: [],
  must_listen: false,
  must_listen_reason: null,
  surprising_observation: null,
}

function coachingCols(coaching: Coaching) {
  return {
    coaching_json: coaching,
    coaching_grade: coaching.overall_grade ?? null,
    coaching_headline: coaching.headline ?? null,
    coaching_must_listen: typeof coaching.must_listen === 'boolean' ? coaching.must_listen : false,
    coaching_must_listen_reason: coaching.must_listen_reason ?? null,
    coaching_red_flags: coaching.red_flags ?? null,
    coaching_never_dos: coaching.never_dos_triggered ?? null,
    coaching_wins: coaching.wins ?? null,
    coaching_improvements: coaching.improvements ?? null,
  }
}

interface CallRow {
  id: string
  direction: string | null
  status: string | null
  from_number: string | null
  to_number: string | null
  recording_duration_seconds: number | null
  duration_seconds: number | null
  created_at: string | null
  handled_by: string | null
  initiated_by: string | null
  coaching_grade?: string | null
  coaching_headline?: string | null
  ai_summary?: string | null
}

type Admin = ReturnType<typeof createAdminClient>

async function recoachOne(admin: Admin, call: CallRow) {
  const { data: air } = await admin
    .from('call_ai_results')
    .select('id, transcript_text, transcript_json')
    .eq('call_id', call.id)
    .eq('engine', 'deepgram_claude')
    .maybeSingle()

  const transcript = ((air?.transcript_text as string | null) || '').trim()
  const dur = call.recording_duration_seconds || call.duration_seconds || 0

  // A call with a voicemail, a non-connecting status, or essentially no
  // conversation has no rep performance to grade -> force N/A (never a letter
  // grade). More reliable than trusting the model to detect it.
  const { count: vmCount } = await admin
    .from('voicemails')
    .select('id', { count: 'exact', head: true })
    .eq('call_id', call.id)
  const hasVoicemail = (vmCount ?? 0) > 0
  const noConvoStatus = ['no-answer', 'busy', 'failed', 'canceled', 'missed'].includes(
    (call.status || '').toLowerCase()
  )

  let analysis: Record<string, unknown> | null = null
  let coaching: Coaching & Record<string, unknown>

  if (noConvoStatus || hasVoicemail || (dur > 0 && dur < 25) || transcript.length < 60) {
    coaching = NA_COACHING
  } else {
    const repName = await resolveRepName(admin, call)
    analysis = await claudeAnalyze(transcript, {
      direction: call.direction || '',
      phone: call.direction === 'inbound' ? call.from_number || '' : call.to_number || '',
      durationSec: dur,
      createdAt: call.created_at,
      repName,
    })
    coaching = (analysis?.coaching as (Coaching & Record<string, unknown>)) ?? NA_COACHING
  }

  // Even with a transcript, a non-conversation often returns all-N/A categories
  // with a stray letter grade. If nothing was actually scored, force N/A.
  if (coaching.overall_grade && coaching.overall_grade !== 'N/A' && !coachingHasRealScore(coaching)) {
    coaching = { ...coaching, overall_grade: 'N/A' }
  }

  // Refresh the customer-facing fields on BOTH calls and call_ai_results. The
  // call-log2 AI Summary reads the deepgram_claude result's `summary`, so if we
  // only updated calls.ai_summary the old "Catherine" text kept showing.
  const extra: Record<string, unknown> = {}
  const airExtra: Record<string, unknown> = {}
  if (analysis) {
    if (typeof analysis.customer_summary === 'string') { extra.ai_summary = analysis.customer_summary; airExtra.summary = analysis.customer_summary }
    if (typeof analysis.call_type === 'string') { extra.call_type = analysis.call_type; airExtra.call_type = analysis.call_type }
    if (Array.isArray(analysis.action_items)) { extra.action_items = analysis.action_items; airExtra.action_items = analysis.action_items }
  } else {
    // Non-conversation: clear stale summary text so old "Catherine ..." doesn't linger.
    extra.ai_summary = null
    airExtra.summary = null
  }

  await admin.from('calls').update({ ...coachingCols(coaching), ...extra }).eq('id', call.id)

  if (air?.id) {
    const tj =
      air.transcript_json && typeof air.transcript_json === 'object'
        ? (air.transcript_json as Record<string, unknown>)
        : {}
    await admin
      .from('call_ai_results')
      .update({ transcript_json: { ...tj, analysis: analysis ?? { coaching } }, ...airExtra })
      .eq('id', air.id)
  }

  return { id: call.id, grade: coaching.overall_grade, headline: coaching.headline, usedAi: !!analysis }
}

const CALL_COLS =
  'id, direction, status, from_number, to_number, recording_duration_seconds, duration_seconds, created_at, handled_by, initiated_by, coaching_grade, coaching_headline, ai_summary'

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authed =
    !!cronSecret &&
    (req.headers.get('x-cron-secret') === cronSecret ||
      req.headers.get('authorization') === `Bearer ${cronSecret}`)
  if (!authed) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as {
    callId?: string
    limit?: number | string
    offset?: number | string
    dryRun?: boolean
  }
  const admin = createAdminClient()

  if (typeof body.callId === 'string') {
    const { data: call } = await admin.from('calls').select(CALL_COLS).eq('id', body.callId).maybeSingle()
    if (!call) return NextResponse.json({ error: 'call not found' }, { status: 404 })
    const c = call as CallRow
    const before = { grade: c.coaching_grade, headline: c.coaching_headline, summary: c.ai_summary }
    if (body.dryRun) return NextResponse.json({ callId: c.id, before, dryRun: true })
    const after = await recoachOne(admin, c)
    return NextResponse.json({ callId: c.id, before, after })
  }

  const limit = Math.min(parseInt(String(body.limit ?? '20'), 10), 50)
  const offset = parseInt(String(body.offset ?? '0'), 10)
  const { data: calls } = await admin
    .from('calls')
    .select(CALL_COLS)
    .not('coaching_grade', 'is', null)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)

  const results: unknown[] = []
  for (const call of (calls ?? []) as CallRow[]) {
    try {
      results.push(await recoachOne(admin, call))
    } catch (e) {
      results.push({ id: call.id, error: e instanceof Error ? e.message : 'failed' })
    }
  }
  return NextResponse.json({ processed: results.length, offset, limit, results })
}
