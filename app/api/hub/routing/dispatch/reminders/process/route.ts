import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { companyJobberUserId } from '@/lib/jobber'
import { addDays, hhmmToMinutes, isoToLocal, normalizeDispatchSettings, todayLocal } from '@/lib/dispatch'
import { buildReminderItems, sendReminders } from '@/lib/dispatch-reminders'

// Day-before reminder sender, for a VPS cron every ~10 minutes:
//   curl -s -X POST https://lynxedo.com/api/hub/routing/dispatch/reminders/process -H "x-cron-secret: $CRON_SECRET"
//
// ⚠ NOT on any crontab yet (Ben, Oct 19 2026: build it, keep it off). Even when
// it is, a company sends nothing until Admin → Routing → Dispatch → Reminders is
// switched ON. Wire it on the PROD crontab only (shared DB; real customers).
// Sends tomorrow's reminders once the company's send time has passed, and never
// after 9 pm (quiet hours). dispatch_reminders makes every send once-only.

const QUIET_FROM = 21 * 60

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: rows } = await admin.from('company_routing_settings').select('company_id, dispatch_settings')
  const now = isoToLocal(new Date().toISOString()).minutes
  const date = addDays(todayLocal(), 1)
  const out: Array<Record<string, unknown>> = []

  for (const row of rows ?? []) {
    const settings = normalizeDispatchSettings(row.dispatch_settings)
    const rs = settings.reminders
    if (!rs.enabled) continue
    if (now < hhmmToMinutes(rs.send_time) || now >= QUIET_FROM) { out.push({ company: row.company_id, waiting: true }); continue }
    const jobberUserId = await companyJobberUserId(row.company_id as string, rs.owner_user_id ?? '')
    if (!jobberUserId) { out.push({ company: row.company_id, error: 'jobber_not_connected' }); continue }
    try {
      const items = await buildReminderItems(admin, row.company_id as string, jobberUserId, date, settings)
      const r = await sendReminders(admin, row.company_id as string, settings, items)
      out.push({ company: row.company_id, date, ...r })
      console.log(`[dispatch-reminders] ${row.company_id} ${date}: sent ${r.sent}, failed ${r.failed}, skipped ${r.skipped}`)
    } catch (e) {
      out.push({ company: row.company_id, error: e instanceof Error ? e.message : 'failed' })
    }
  }
  return NextResponse.json({ ok: true, results: out })
}
