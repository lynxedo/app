import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { twilioConfigured } from '@/lib/twilio'
import { runAmberTextTurn } from '@/lib/amber-text'

// Amber-over-text cron drainer (Track D). Mirrors /api/drip/process: the VPS
// prod cron POSTs every 1–2 minutes with the cron secret:
//   curl -s -X POST https://lynxedo.com/api/amber/text/process -H "x-cron-secret: $CRON_SECRET"
//
// One tick drains every DUE amber_text_threads row (status='active',
// next_turn_at <= now) through runAmberTextTurn under a wall-clock budget. Each
// turn re-checks for a human seize + STOP right before it sends, so a thread a
// teammate has taken over is skipped. Amber re-arms a thread only when the lead
// sends another inbound reply (via maybeEnqueueAmberTurn from sms/inbound).
//
// ⚠ Like the drip + email crons, wire this on the PROD VPS crontab only — the
// audience is real leads. Everything stays dark until the per-line dial +
// autonomy 'auto' are turned on AND AMBER_TEXT_TEST_MODE is set to 'false'.

const BATCH_MAX_MS = 50_000
const PROCESS_MAX_PER_TICK = 50

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const startedAt = Date.now()

  const { data: due, error } = await admin
    .from('amber_text_threads')
    .select('conversation_id')
    .eq('status', 'active')
    .not('next_turn_at', 'is', null)
    .lte('next_turn_at', new Date().toISOString())
    .order('next_turn_at', { ascending: true })
    .limit(PROCESS_MAX_PER_TICK)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let processed = 0
  for (const row of (due ?? []) as { conversation_id: string }[]) {
    if (Date.now() - startedAt > BATCH_MAX_MS) break
    processed++
    // runAmberTextTurn is best-effort (never throws), but guard anyway so one bad
    // thread can't abort the whole batch.
    try {
      await runAmberTextTurn(admin, { conversationId: row.conversation_id })
    } catch (err) {
      console.warn('[amber/process] turn failed', row.conversation_id, err)
    }
  }

  return NextResponse.json({
    due: (due ?? []).length,
    processed,
    elapsed_ms: Date.now() - startedAt,
  })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'amber/text/process',
    twilio_configured: twilioConfigured(),
  })
}
