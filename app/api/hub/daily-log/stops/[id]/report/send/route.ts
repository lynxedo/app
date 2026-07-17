import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendDirectTxtToPhone } from '@/lib/txt-send'
import { getBusinessProfile } from '@/lib/business-profile'

function buildReportMessage(args: {
  firstName: string
  mainService: string | null
  additionalServices: string[]
  issuesFound: string[]
  notes: string | null
  businessName: string
}): string {
  const lines: string[] = [`Hi ${args.firstName || 'there'}, thanks for letting us service your property today!`]

  if (args.mainService) {
    lines.push('', `Service completed: ${args.mainService}`)
  }

  if (args.additionalServices.length > 0) {
    lines.push('', 'Additional services:')
    for (const s of args.additionalServices) lines.push(`• ${s}`)
  }

  if (args.issuesFound.length > 0) {
    lines.push('', 'Items noted:')
    for (const s of args.issuesFound) lines.push(`• ${s}`)
  }

  if (args.notes) {
    lines.push('', `Notes: ${args.notes}`)
  }

  lines.push('', `— ${args.businessName}`)
  return lines.join('\n')
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const admin = createAdminClient()

  // Load stop with phone + company scope check.
  const { data: stop } = await admin
    .from('daily_log_stops')
    .select('id, client_name, client_phone, daily_log_entries!inner(company_id)')
    .eq('id', id)
    .single()
  if (!stop) return NextResponse.json({ error: 'Stop not found' }, { status: 404 })

  const entry = Array.isArray(stop.daily_log_entries)
    ? stop.daily_log_entries[0]
    : stop.daily_log_entries
  if (!entry || entry.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Stop not found' }, { status: 404 })
  }
  if (!stop.client_phone) {
    return NextResponse.json({ error: 'No phone number on file for this stop.' }, { status: 422 })
  }

  // Do-not-text check.
  const rawDigits = stop.client_phone.replace(/\D/g, '')
  const possiblePhones = [stop.client_phone, rawDigits]
  if (rawDigits.length === 10) possiblePhones.push(`+1${rawDigits}`, `1${rawDigits}`)

  const { data: txtMatch } = await admin
    .from('txt_contacts')
    .select('do_not_text')
    .eq('company_id', profile.company_id)
    .in('phone', possiblePhones)
    .limit(1)
    .maybeSingle()
  if (txtMatch?.do_not_text) {
    return NextResponse.json({ error: 'Customer is on the do-not-text list.' }, { status: 422 })
  }

  const { data: hubMatch } = await admin
    .from('hub_contacts')
    .select('do_not_text')
    .eq('company_id', profile.company_id)
    .in('phone', possiblePhones)
    .limit(1)
    .maybeSingle()
  if (hubMatch?.do_not_text) {
    return NextResponse.json({ error: 'Customer is on the do-not-text list.' }, { status: 422 })
  }

  // Load the report.
  const { data: report } = await admin
    .from('daily_log_stop_reports')
    .select('id, main_service, additional_services, issues_found, notes')
    .eq('stop_id', id)
    .single()
  if (!report) {
    return NextResponse.json({ error: 'No report found for this stop. Save the report first.' }, { status: 422 })
  }

  const { businessName } = await getBusinessProfile(admin, profile.company_id)

  const firstName = stop.client_name.trim().split(/\s+/)[0] || ''
  const message = buildReportMessage({
    firstName,
    mainService: report.main_service,
    additionalServices: (report.additional_services ?? []) as string[],
    issuesFound: (report.issues_found ?? []) as string[],
    notes: report.notes,
    businessName,
  })

  // Send via the Twilio Txt stack (unified thread + inbound replies route back
  // to the Txt inbox) — replaces the retired Captivated MCP send_text path.
  const result = await sendDirectTxtToPhone({
    admin,
    companyId: profile.company_id,
    userId: user.id,
    phone: stop.client_phone,
    name: stop.client_name,
    body: message,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Send failed' }, { status: 502 })
  }

  // Stamp the report as sent.
  const nowIso = new Date().toISOString()
  await admin
    .from('daily_log_stop_reports')
    .update({ sent_at: nowIso, sent_by: user.id })
    .eq('id', report.id)

  return NextResponse.json({
    ok: true,
    sent_at: nowIso,
    rendered_message: message,
  })
}
