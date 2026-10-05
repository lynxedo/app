import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { contactInCompany, newShareToken } from '@/lib/irrigation-server'
import { resolveAsrAccess } from '@/lib/after-service-server'
import { REPORT_SHARE_TTL_DAYS } from '@/lib/after-service'
import { sendDirectTxtToPhone } from '@/lib/txt-send'
import { sendEmail, formatFrom } from '@/lib/resend'
import { resolveSendIdentity } from '@/lib/email-identities'
import { getBusinessProfile } from '@/lib/business-profile'

// POST /api/hub/contacts/:id/service-reports/:reportId/send   { via: ['text'] | ['email'] | ['text','email'] }
//
// The tech's Send button (Ben, Oct 5 2026: "a button to send the report via
// email, text or both" — never automatic). Mints (or reuses) the customer link
// and sends it by text through the Txt stack (do-not-text respected) and/or by
// email from the company's default verified sending identity (hard bounces and
// spam complaints respected; a marketing unsubscribe does not stop a service
// report the customer paid for). Each channel is tried on its own and reported
// back; the report is stamped sent if at least one went out.

const TTL_MS = REPORT_SHARE_TTL_DAYS * 24 * 60 * 60 * 1000

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; reportId: string }> }) {
  const { id: contactId, reportId } = await params
  const access = await resolveAsrAccess()
  if ('error' in access) return access.error
  if (!access.canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createAdminClient()
  if (!(await contactInCompany(admin, contactId, access.companyId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => ({})) as { via?: unknown }
  const via = Array.isArray(body.via) ? body.via.filter((v): v is 'text' | 'email' => v === 'text' || v === 'email') : []
  const channels = Array.from(new Set(via))
  if (channels.length === 0) return NextResponse.json({ error: 'Pick Text, Email or both.' }, { status: 400 })

  const { data: rep } = await admin
    .from('after_service_reports')
    .select('id, status, service_date, share_token, share_expires_at, sent_via')
    .eq('id', reportId)
    .eq('company_id', access.companyId)
    .eq('contact_id', contactId)
    .maybeSingle()
  if (!rep) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (rep.status !== 'final') return NextResponse.json({ error: 'Save the report before sending it.' }, { status: 400 })

  const { data: contact } = await admin
    .from('txt_contacts')
    .select('id, name, first_name, phone, email, do_not_text')
    .eq('id', contactId)
    .maybeSingle()
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Up-front checks so nothing half-sends for a reason we can see now.
  if (channels.includes('text')) {
    if (!contact.phone) return NextResponse.json({ error: 'This customer has no phone number on file.' }, { status: 400 })
    if (contact.do_not_text) return NextResponse.json({ error: 'This customer is marked do-not-text. Send by email instead.' }, { status: 400 })
  }
  const email = ((contact.email as string | null) ?? '').trim()
  if (channels.includes('email')) {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'This customer has no email address on file.' }, { status: 400 })
    }
    const { data: sup } = await admin
      .from('email_suppressions')
      .select('reason')
      .eq('company_id', access.companyId)
      .in('email', Array.from(new Set([email, email.toLowerCase()])))
      .in('reason', ['bounce', 'complaint'])
      .limit(1)
    if (sup && sup.length > 0) {
      return NextResponse.json({
        error: sup[0].reason === 'bounce'
          ? 'Email to this address has bounced before, so it won’t be sent. Send by text instead.'
          : 'This customer marked our email as spam, so it won’t be sent. Send by text instead.',
      }, { status: 400 })
    }
  }

  // The customer link: reuse a live one, else mint a fresh one (60 days).
  const now = new Date()
  let token = rep.share_token as string | null
  const live = !!token && !!rep.share_expires_at && new Date(rep.share_expires_at as string) > now
  if (!live) {
    token = newShareToken()
    const { error } = await admin
      .from('after_service_reports')
      .update({ share_token: token, share_expires_at: new Date(now.getTime() + TTL_MS).toISOString() })
      .eq('id', rep.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com'
  const url = `${baseUrl}/report/${token}`

  const profile = await getBusinessProfile(admin, access.companyId)
  const first = ((contact.first_name as string | null) || (contact.name as string | null) || '').trim().split(/\s+/)[0] || ''
  const todayCentral = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now)
  const when = rep.service_date && rep.service_date !== todayCentral
    ? new Date(`${rep.service_date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : 'today'

  const results: { text?: { ok: boolean; error?: string }; email?: { ok: boolean; error?: string } } = {}

  if (channels.includes('text')) {
    const r = await sendDirectTxtToPhone({
      admin,
      companyId: access.companyId,
      userId: access.userId,
      phone: contact.phone as string,
      name: contact.name as string | null,
      body: `${first ? `Hi ${first}, ` : ''}thanks for having us out ${when === 'today' ? 'today' : `on ${when}`}! Here's your lawn treatment report — what we did, what we saw, and how to care for your lawn: ${url}`,
    })
    results.text = r.ok ? { ok: true } : { ok: false, error: r.error || 'Text failed' }
  }

  if (channels.includes('email')) {
    const identity = await resolveSendIdentity(admin, access.companyId)
    if (!identity) {
      results.email = { ok: false, error: 'No email sending address is set up for the company.' }
    } else {
      const biz = esc(profile.businessName)
      const html = `<!doctype html><html><body style="margin:0;background:#eef2f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#16211e">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#fff;border-radius:14px;overflow:hidden">
<div style="background:#2f6b3a;color:#fff;padding:20px">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">${biz}</div>
<div style="font-size:20px;font-weight:600;margin-top:4px">Your lawn treatment report</div>
</div>
<div style="padding:20px;font-size:15px;line-height:1.6">
<p style="margin:0 0 12px">${first ? `Hi ${esc(first)},` : 'Hello,'}</p>
<p style="margin:0 0 16px">Thanks for having us out ${when === 'today' ? 'today' : `on ${esc(when)}`}. Your report shows what we did, what we saw at your property, and how to care for your lawn until our next visit.</p>
<p style="margin:0 0 20px"><a href="${esc(url)}" style="display:inline-block;background:#2f6b3a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">View your report</a></p>
<p style="margin:0;color:#5a6b64;font-size:13px">Questions? Just reply to this email or call us at ${esc(profile.phone)}.</p>
</div>
</div>
<div style="text-align:center;color:#5a6b64;font-size:12px;padding:12px">${biz}${identity.physical_address ? ` · ${esc(identity.physical_address)}` : ''}</div>
</div></body></html>`
      const text = `${first ? `Hi ${first},` : 'Hello,'}\n\nThanks for having us out ${when === 'today' ? 'today' : `on ${when}`}. Here's your lawn treatment report — what we did, what we saw, and how to care for your lawn:\n\n${url}\n\nQuestions? Reply to this email or call us at ${profile.phone}.\n\n${profile.businessName}`
      const r = await sendEmail({
        from: formatFrom(identity.from_name, identity.from_email),
        replyTo: identity.reply_to ?? undefined,
        to: email,
        subject: `Your lawn treatment report — ${when === 'today' ? now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : when}`,
        html,
        text,
        tags: [{ name: 'kind', value: 'after_service_report' }],
      })
      results.email = r.ok ? { ok: true } : { ok: false, error: r.error === 'resend_not_configured' ? 'Email isn’t set up on this server.' : r.error }
    }
  }

  const sent = (Object.entries(results) as ['text' | 'email', { ok: boolean }][]).filter(([, r]) => r.ok).map(([k]) => k)
  if (sent.length > 0) {
    const prior = (rep.sent_via as string[] | null) ?? []
    await admin
      .from('after_service_reports')
      .update({ sent_at: now.toISOString(), sent_via: Array.from(new Set([...prior, ...sent])), updated_at: now.toISOString() })
      .eq('id', rep.id)
  }

  const failed = (Object.entries(results) as ['text' | 'email', { ok: boolean; error?: string }][]).filter(([, r]) => !r.ok)
  return NextResponse.json(
    { ok: sent.length > 0, sent, results, url, error: failed.length > 0 ? failed.map(([k, r]) => `${k === 'text' ? 'Text' : 'Email'}: ${r.error}`).join(' · ') : undefined },
    { status: sent.length > 0 ? 200 : 502 },
  )
}
