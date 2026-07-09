import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { claudeAnalyze } from '@/lib/call-transcribe'
import { coachingHasRealScore } from '@/lib/call-rubric'

// Re-score the frozen Unitel call_logs through the CURRENT coaching rubric,
// reusing each row's already-saved transcript (no re-recording). This is the
// call_logs counterpart to app/api/dialer/calls/recoach — the old log was
// originally scored by a separate, older rubric copy and stores coaching in
// flattened columns (overall_grade, headline, red_flags[], never_dos[],
// top_wins[], top_improvements[], coaching_json) rather than calls.coaching_*.
// Cron-secret protected. POST body:
//   { id }                    -> re-score one call_logs row, returns before/after
//   { limit?, offset? }       -> batch over rows that already have overall_grade
//   { dryRun: true } + id     -> returns current values, writes nothing
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

// Non-conversation / too-short rows must never carry a letter grade — same
// guardrail the dialer path uses.
const NA_COACHING = {
  overall_grade: 'N/A',
  headline: 'No scorable conversation (too short or not a real conversation to evaluate).',
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

// Map the rubric's coaching object onto the call_logs column names. Note the
// field renames vs the dialer table: never_dos_triggered -> never_dos,
// wins -> top_wins, improvements -> top_improvements.
function coachingCols(coaching: Coaching) {
  return {
    coaching_json: coaching,
    overall_grade: coaching.overall_grade ?? null,
    headline: coaching.headline ?? null,
    must_listen: typeof coaching.must_listen === 'boolean' ? coaching.must_listen : false,
    must_listen_reason: coaching.must_listen_reason ?? null,
    red_flags: (coaching.red_flags ?? null) as string[] | null,
    never_dos: (coaching.never_dos_triggered ?? null) as string[] | null,
    top_wins: (coaching.wins ?? null) as string[] | null,
    top_improvements: (coaching.improvements ?? null) as string[] | null,
  }
}

interface LogRow {
  id: string
  direction: string | null
  phone: string | null
  duration_seconds: number | null
  call_datetime: string | null
  rep_name: string | null
  transcript_text: string | null
  overall_grade?: string | null
  headline?: string | null
  customer_summary?: string | null
}

type Admin = ReturnType<typeof createAdminClient>

async function recoachOne(admin: Admin, row: LogRow) {
  const transcript = (row.transcript_text || '').trim()
  const dur = row.duration_seconds || 0

  let analysis: Record<string, unknown> | null = null
  let coaching: Coaching & Record<string, unknown>

  // Unitel only logged connected/recorded calls, so there's no status/voicemail
  // to consult — fall back to duration + transcript length to spot the
  // occasional too-short / garbled capture.
  if ((dur > 0 && dur < 25) || transcript.length < 60) {
    coaching = NA_COACHING
  } else {
    analysis = await claudeAnalyze(transcript, {
      direction: row.direction || '',
      phone: row.phone || '',
      durationSec: dur,
      createdAt: row.call_datetime,
      repName: row.rep_name || null,
    })
    coaching = (analysis?.coaching as (Coaching & Record<string, unknown>)) ?? NA_COACHING
  }

  // A non-conversation often returns all-N/A categories with a stray letter
  // grade. If nothing was actually scored, force N/A.
  if (coaching.overall_grade && coaching.overall_grade !== 'N/A' && !coachingHasRealScore(coaching)) {
    coaching = { ...coaching, overall_grade: 'N/A' }
  }

  // Refresh the customer-facing fields too (also clears any legacy "Catherine"
  // rendering the old rubric left in the summary).
  const extra: Record<string, unknown> = {}
  if (analysis) {
    if (typeof analysis.customer_summary === 'string') extra.customer_summary = analysis.customer_summary
    if (typeof analysis.call_type === 'string') extra.call_type = analysis.call_type
    if (Array.isArray(analysis.action_items)) extra.action_items = analysis.action_items
  }

  await admin
    .from('call_logs')
    .update({ ...coachingCols(coaching), ...extra } as never)
    .eq('id', row.id)

  return { id: row.id, grade: coaching.overall_grade, headline: coaching.headline, usedAi: !!analysis }
}

const LOG_COLS =
  'id, direction, phone, duration_seconds, call_datetime, rep_name, transcript_text, overall_grade, headline, customer_summary'

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authed =
    !!cronSecret &&
    (req.headers.get('x-cron-secret') === cronSecret ||
      req.headers.get('authorization') === `Bearer ${cronSecret}`)
  if (!authed) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as {
    id?: string
    limit?: number | string
    offset?: number | string
    dryRun?: boolean
  }
  const admin = createAdminClient()

  if (typeof body.id === 'string') {
    const { data: row } = await admin.from('call_logs').select(LOG_COLS).eq('id', body.id).maybeSingle()
    if (!row) return NextResponse.json({ error: 'call not found' }, { status: 404 })
    const r = row as LogRow
    const before = { grade: r.overall_grade, headline: r.headline, summary: r.customer_summary }
    if (body.dryRun) return NextResponse.json({ id: r.id, before, dryRun: true })
    const after = await recoachOne(admin, r)
    return NextResponse.json({ id: r.id, before, after })
  }

  const limit = Math.min(parseInt(String(body.limit ?? '20'), 10), 50)
  const offset = parseInt(String(body.offset ?? '0'), 10)
  const { data: rows } = await admin
    .from('call_logs')
    .select(LOG_COLS)
    .not('overall_grade', 'is', null)
    .order('call_datetime', { ascending: true })
    .range(offset, offset + limit - 1)

  const results: unknown[] = []
  for (const row of (rows ?? []) as LogRow[]) {
    try {
      results.push(await recoachOne(admin, row))
    } catch (e) {
      results.push({ id: row.id, error: e instanceof Error ? e.message : 'failed' })
    }
  }
  return NextResponse.json({ processed: results.length, offset, limit, results })
}
