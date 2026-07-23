import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { postGuardianToUserDm } from '@/lib/guardian-post'
import { sendHubPush } from '@/lib/hub-push'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Called by VPS cron (wiring is a later manual step) — DOES send real Guardian
// DMs + pushes:
//   curl -s -X POST https://lynxedo.com/api/hub/email/followup-check \
//     -H "x-cron-secret: $CRON_SECRET"
// Each thread whose follow-up reminder has come due DMs its follow_up_by user
// exactly once (follow_up_notified_at marker); re-scheduling a reminder clears
// that marker (see the follow-up route) so it can fire again.

type Thread = {
  id: string
  company_id: string
  subject: string | null
  follow_up_at: string
  follow_up_by: string | null
  follow_up_note: string | null
}

// Health check — no secret required; returns nothing sensitive.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'hub/email/followup-check' })
}

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()

  // Due reminders that haven't been notified yet, on still-unresolved threads.
  const { data: rows, error } = await admin
    .from('inbox_threads')
    .select('id, company_id, subject, follow_up_at, follow_up_by, follow_up_note')
    .lte('follow_up_at', new Date().toISOString())
    .is('follow_up_notified_at', null)
    .is('deleted_at', null)
    .neq('status', 'closed')
    .order('follow_up_at', { ascending: true })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const threads = (rows ?? []) as Thread[]
  let notified = 0

  for (const t of threads) {
    // Best-effort per thread — a single bad row must not abort the sweep.
    try {
      if (t.follow_up_by) {
        const subject = t.subject || '(no subject)'
        const body =
          `Follow-up due on "${subject}"` +
          (t.follow_up_note ? ` — ${t.follow_up_note}` : '') +
          ` Open the Inbox to handle it.`

        await postGuardianToUserDm(t.company_id, t.follow_up_by, body, { admin })
        await sendHubPush(
          [t.follow_up_by],
          { title: 'Inbox follow-up reminder', body, url: '/hub/email', type: 'inbox_followup' },
          { isDm: true },
        )
        notified++
      }

      // Stamp regardless — a reminder with no owner has nobody to notify, and
      // stamping stops us from re-scanning it every run.
      await admin
        .from('inbox_threads')
        .update({ follow_up_notified_at: new Date().toISOString() })
        .eq('id', t.id)
    } catch (err) {
      console.error('[inbox:followup-check] thread failed:', t.id, (err as Error).message)
    }
  }

  return NextResponse.json({ ok: true, checked: threads.length, notified })
}
