import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processPendingCall } from '@/lib/call-transcribe'

export const dynamic = 'force-dynamic'

// Cron-driven backstop for the Twilio call transcription pipeline. Wire on the
// VPS (mirror staging + prod):
//   */1 * * * * curl -s -X POST https://lynxedo.com/api/dialer/calls/transcribe/process \
//     -H "x-cron-secret: $CRON_SECRET"
//
// The recording webhook normally fires the per-call transcribe route
// fire-and-forget, so most calls are already done by the time this runs. This
// sweeps anything the fast path missed (server restart, transient failure).
// processPendingCall atomically claims each row (pending -> processing) so an
// overlapping cron run or the webhook kickoff can't double-process.
//
// Also re-queues rows stuck in 'processing' for >15 min (a crash mid-run) by
// flipping them back to pending first.
export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Recover rows wedged in 'processing' (a prior run crashed mid-transcription).
  // We have no processing-started timestamp, so this uses created_at (the call
  // start) as a coarse signal with a wide 30-min window — no real transcription
  // takes that long. A rare false re-queue of an in-flight long call is harmless:
  // processPendingCall re-claims it and call_ai_results upserts on (call_id,
  // engine), so a double run just overwrites, never duplicates.
  const staleCutoff = new Date(Date.now() - 30 * 60_000).toISOString()
  await admin
    .from('calls')
    .update({ transcription_status: 'pending' })
    .eq('transcription_status', 'processing')
    .lt('created_at', staleCutoff)

  const { data: pending, error } = await admin
    .from('calls')
    .select('id')
    .eq('transcription_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(10)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!pending || pending.length === 0) {
    return NextResponse.json({ processed: 0 })
  }

  const results = []
  for (const row of pending) {
    try {
      results.push(await processPendingCall(row.id))
    } catch (e) {
      results.push({
        callId: row.id,
        status: 'error' as const,
        engines: [],
        error: e instanceof Error ? e.message : 'process error',
      })
    }
  }

  return NextResponse.json({
    processed: results.filter((r) => r.status === 'complete').length,
    results,
  })
}

export async function GET() {
  return NextResponse.json({ ok: true, route: 'dialer.calls.transcribe.process' })
}
