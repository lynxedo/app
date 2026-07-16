import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { twilioConfigured } from '@/lib/twilio'
import { runDripEnrollmentSweeps, advanceDripEnrollments } from '@/lib/drip'

// Called by the VPS cron (prod) every 1–2 minutes:
//   curl -s -X POST https://lynxedo.com/api/drip/process -H "x-cron-secret: $CRON_SECRET"
//
// One tick = (1) sweep triggers (new_lead / lead_source) into enrollments, then
// (2) advance every due enrollment's state machine under a wall-clock budget.
// Only 'active' campaigns enroll or advance, so draft/paused ones are inert.
// HOLDs (no-op, queue intact) when Twilio isn't configured.
//
// ⚠ Like the email automation cron, this is wired on the PROD VPS crontab only —
// the audience is real leads. Controlled staging tests use a manual cron-secret
// POST against a narrow test campaign (a single test lead / test lead_source).

const BATCH_MAX_MS = 50_000
const PROCESS_MAX_PER_TICK = 300

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!twilioConfigured()) {
    return NextResponse.json({ processed: 0, held: true, message: 'twilio_not_configured' })
  }

  const admin = createAdminClient()
  const startedAt = Date.now()

  const sweep = await runDripEnrollmentSweeps(admin)
  const adv = await advanceDripEnrollments(admin, {
    startedAt,
    maxMs: BATCH_MAX_MS,
    maxCount: PROCESS_MAX_PER_TICK,
  })

  return NextResponse.json({
    enrolled: sweep.enrolled,
    processed: adv.processed,
    sent: adv.sent,
    elapsed_ms: Date.now() - startedAt,
  })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'drip/process',
    twilio_configured: twilioConfigured(),
  })
}
