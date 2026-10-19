import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { companyJobberUserId } from '@/lib/jobber'
import { createAdminClient } from '@/lib/supabase/admin'
import { addDays, normalizeDispatchSettings, todayLocal } from '@/lib/dispatch'
import { buildReminderItems } from '@/lib/dispatch-reminders'

// Preview of a day's Hub reminders — exactly who would get which text/email,
// built by the same code the sender uses. Read-only; sends nothing.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const { companyId, userId } = auth
  const qd = new URL(request.url).searchParams.get('date') ?? ''
  const date = DATE_RE.test(qd) ? qd : addDays(todayLocal(), 1)

  const jobberUserId = await companyJobberUserId(companyId, userId)
  if (!jobberUserId) return NextResponse.json({ error: 'Jobber is not connected for your company' }, { status: 400 })

  const admin = createAdminClient()
  const { data: s } = await admin.from('company_routing_settings').select('dispatch_settings').eq('company_id', companyId).maybeSingle()
  const settings = normalizeDispatchSettings(s?.dispatch_settings)
  try {
    const [items, { data: log }] = await Promise.all([
      buildReminderItems(admin, companyId, jobberUserId, date, settings),
      admin.from('dispatch_reminders').select('jobber_item_id, channel, status, error, sent_at').eq('company_id', companyId).eq('visit_date', date),
    ])
    return NextResponse.json({
      date,
      enabled: settings.reminders.enabled,
      sendTime: settings.reminders.send_time,
      ownerSet: !!settings.reminders.owner_user_id,
      templates: settings.reminders.templates.length,
      items,
      log: log ?? [],
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not build the preview' }, { status: 500 })
  }
}
