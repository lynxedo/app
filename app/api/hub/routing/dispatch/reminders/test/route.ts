import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { companyJobberUserId } from '@/lib/jobber'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSms, toE164 } from '@/lib/twilio'
import { addDays, normalizeDispatchSettings, todayLocal } from '@/lib/dispatch'
import { buildReminderItems, sendReminderEmail } from '@/lib/dispatch-reminders'

// "Text me a sample": renders one real reminder from the preview and sends it to
// the SIGNED-IN person's own phone (Settings → profile phone) and/or email —
// never to the customer, never logged as sent. Works while the switch is OFF.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function POST(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const { companyId, userId, supabase } = auth

  const body = await request.json().catch(() => null) as { itemId?: string; date?: string } | null
  const date = body?.date && DATE_RE.test(body.date) ? body.date : addDays(todayLocal(), 1)

  const jobberUserId = await companyJobberUserId(companyId, userId)
  if (!jobberUserId) return NextResponse.json({ error: 'Jobber is not connected for your company' }, { status: 400 })

  const admin = createAdminClient()
  const [{ data: s }, { data: me }, { data: { user } }] = await Promise.all([
    admin.from('company_routing_settings').select('dispatch_settings').eq('company_id', companyId).maybeSingle(),
    admin.from('user_profiles').select('phone').eq('id', userId).maybeSingle(),
    supabase.auth.getUser(),
  ])
  const settings = normalizeDispatchSettings(s?.dispatch_settings)
  const items = await buildReminderItems(admin, companyId, jobberUserId, date, settings)
  const item = (body?.itemId ? items.find(i => i.jobberItemId === body.itemId) : null) ?? items.find(i => i.sms || i.email_msg)
  if (!item) return NextResponse.json({ error: 'Nothing would be sent that day — add a template first.' }, { status: 400 })

  const results: string[] = []
  if (item.sms) {
    const to = toE164((me?.phone as string | null) ?? '')
    if (!to) results.push('Text: add your phone in Settings → Profile to get a sample.')
    else {
      const r = await sendSms({ to, body: `[Sample — would go to ${item.clientName}]\n${item.sms.body}` })
      results.push(r.ok ? `Text sent to your phone.` : `Text failed: ${r.error}`)
    }
  }
  if (item.email_msg) {
    const to = user?.email
    if (!to) results.push('Email: no email on your login.')
    else {
      const r = await sendReminderEmail(admin, companyId, settings, { to, subject: `[Sample] ${item.email_msg.subject}`, body: item.email_msg.body })
      results.push(r.ok ? `Email sent to ${to}.` : `Email failed: ${r.error}`)
    }
  }
  return NextResponse.json({ item: item.clientName, results })
}
