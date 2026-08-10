import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveIrrigationAccess, contactInCompany, newShareToken } from '@/lib/irrigation-server'
import { sendDirectTxtToPhone } from '@/lib/txt-send'
import { shareExpiryFromNow } from '@/lib/irrigation'

// POST /api/hub/contacts/:id/irrigation/:inspId/text
// Mint (or refresh) the customer-facing share link for a finalized inspection and
// text it to the customer through the normal Txt stack. Requires can_access_irrigation.

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; inspId: string }> }) {
  const { id: contactId, inspId } = await params
  const access = await resolveIrrigationAccess()
  if ('error' in access) return access.error
  if (!access.canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  if (!(await contactInCompany(admin, contactId, access.companyId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: insp } = await admin
    .from('irrigation_inspections')
    .select('id, status, share_token, share_expires_at')
    .eq('id', inspId)
    .eq('company_id', access.companyId)
    .eq('contact_id', contactId)
    .maybeSingle()
  if (!insp) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (insp.status !== 'final') {
    return NextResponse.json({ error: 'Save the inspection before texting a summary.' }, { status: 400 })
  }

  const { data: contact } = await admin
    .from('txt_contacts')
    .select('id, name, first_name, phone, do_not_text')
    .eq('id', contactId)
    .maybeSingle()
  if (!contact?.phone) return NextResponse.json({ error: 'This customer has no phone number on file.' }, { status: 400 })
  if (contact.do_not_text) return NextResponse.json({ error: 'This customer is marked do-not-text.' }, { status: 400 })

  // Reuse a still-valid token; otherwise mint a fresh one (which quietly
  // revokes any previous link for this inspection).
  const nowIso = new Date().toISOString()
  const tokenValid =
    !!insp.share_token && !!insp.share_expires_at && new Date(insp.share_expires_at) > new Date()
  let token = insp.share_token as string | null
  if (!tokenValid) {
    token = newShareToken()
    const { error: tokErr } = await admin
      .from('irrigation_inspections')
      .update({ share_token: token, share_expires_at: shareExpiryFromNow(nowIso) })
      .eq('id', inspId)
    if (tokErr) return NextResponse.json({ error: tokErr.message }, { status: 500 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com'
  const url = `${baseUrl}/irrigation/${token}`
  const first = (contact.first_name || contact.name || '').trim().split(/\s+/)[0] || ''
  const greeting = first ? `Hi ${first}, ` : ''
  const body = `${greeting}here's an overview of your irrigation system: ${url}`

  const result = await sendDirectTxtToPhone({
    admin,
    companyId: access.companyId,
    userId: access.userId,
    phone: contact.phone,
    name: contact.name,
    body,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'Text failed' }, { status: 502 })
  }

  return NextResponse.json({ ok: true, url, conversationId: result.conversation_id })
}
