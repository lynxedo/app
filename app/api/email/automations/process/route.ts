import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resendConfigured } from '@/lib/resend'
import { runEnrollmentSweeps, advanceDueEnrollments } from '@/lib/email-automations'

// Called by VPS cron every minute:
//   curl -s -X POST https://lynxedo.com/api/email/automations/process \
//     -H "x-cron-secret: $CRON_SECRET"
//
// One tick = (1) sweep triggers into enrollments, then (2) advance every due
// enrollment's state machine under a wall-clock budget. Only 'active' automations
// enroll or advance, so a draft/paused journey is inert. HOLDs (no-op, queue
// intact) when RESEND_API_KEY is unset.
//
// ⚠ Wired on the PROD VPS crontab only — the audience is real customer contacts,
// so we never auto-run it against staging. Controlled staging tests use a manual
// cron-secret POST against a draft→active test automation.

const BATCH_MAX_MS = 50_000
const PROCESS_MAX_PER_TICK = 300

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!resendConfigured()) {
    return NextResponse.json({ processed: 0, held: true, message: 'resend_not_configured' })
  }

  const admin = createAdminClient()
  const startedAt = Date.now()
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://lynxedo.com').replace(/\/$/, '')

  const sweep = await runEnrollmentSweeps(admin)
  const adv = await advanceDueEnrollments(admin, {
    startedAt,
    maxMs: BATCH_MAX_MS,
    maxCount: PROCESS_MAX_PER_TICK,
    baseUrl,
  })

  return NextResponse.json({
    enrolled: sweep.enrolled,
    processed: adv.processed,
    sent: adv.sent,
    elapsed_ms: Date.now() - startedAt,
  })
}
