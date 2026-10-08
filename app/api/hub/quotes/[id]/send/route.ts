import { NextResponse, after } from 'next/server'
import { jobberStepInBackground, pushQuoteToJobber } from '@/lib/quote-jobber'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveQuoteCaller } from '@/lib/quote-access'
import { sendDirectTxtToPhone } from '@/lib/txt-send'
import { sendEmail, formatFrom } from '@/lib/resend'
import { resolveSendIdentity } from '@/lib/email-identities'
import { getBusinessProfile } from '@/lib/business-profile'
import { contactDisplayName } from '@/lib/quote-server'
import { expiryFrom, quoteTotals, unpricedItems, type QuoteItem } from '@/lib/quotes'

// POST /api/hub/quotes/:id/send   { via: ['text'] | ['email'] | ['text','email'] }
//
// Sends the customer the link to their quote page (Phase 4, session 4) — by
// text through the Txt stack (do-not-text respected; the customer asked for
// pricing, so it's transactional) and/or by email from the company's default
// verified identity (hard bounces / spam complaints respected). A draft
// becomes Sent and its 30-day clock starts (Ben); sending again re-sends the
// same link and leaves the clock alone. Each channel is tried on its own; the
// quote is stamped sent if at least one went out. Anyone who can build quotes.

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await resolveQuoteCaller('use')
  if ('error' in c) return c.error
  const { id } = await params
  const admin = createAdminClient()

  const body = await request.json().catch(() => ({})) as { via?: unknown }
  const channels = Array.from(new Set(Array.isArray(body.via) ? body.via.filter((v): v is 'text' | 'email' => v === 'text' || v === 'email') : []))
  if (channels.length === 0) return NextResponse.json({ error: 'Pick Text, Email or both.' }, { status: 400 })

  const { data: q } = await admin.from('quotes')
    .select('id, contact_id, title, status, share_token, sent_at, sent_via, expires_at, lead_id')
    .eq('company_id', c.companyId).eq('id', id).is('deleted_at', null).maybeSingle()
  if (!q) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  if (q.status === 'approved') return NextResponse.json({ error: 'This quote is already approved.' }, { status: 409 })
  if (q.status === 'archived') return NextResponse.json({ error: 'This quote is archived.' }, { status: 409 })
  const isResend = q.status !== 'draft'
  if (isResend && q.expires_at && new Date(q.expires_at as string) <= new Date()) {
    return NextResponse.json({ error: 'This quote has expired — make a new one (Duplicate) to send fresh prices.' }, { status: 409 })
  }

  // Ready to send?
  const { data: rows } = await admin.from('quote_line_items').select('name, optional, quantity, unit_price').eq('quote_id', id).eq('company_id', c.companyId)
  const items = (rows ?? []) as QuoteItem[]
  if (!items.some(i => !i.optional)) return NextResponse.json({ error: 'Add at least one line to “What’s included” before sending.' }, { status: 400 })
  const unpriced = unpricedItems(items)
  if (unpriced.length) return NextResponse.json({ error: `Price every line before sending: ${unpriced.map(i => i.name).join(', ')}` }, { status: 400 })
  if (!String(q.title ?? '').trim()) return NextResponse.json({ error: 'Give the quote a title before sending.' }, { status: 400 })

  const { data: contact } = await admin.from('txt_contacts')
    .select('id, name, first_name, last_name, company_name, phone, email, do_not_text')
    .eq('company_id', c.companyId).eq('id', q.contact_id).maybeSingle()
  if (!contact) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  if (channels.includes('text')) {
    if (!contact.phone) return NextResponse.json({ error: 'This customer has no phone number on file.' }, { status: 400 })
    if (contact.do_not_text) return NextResponse.json({ error: 'This customer is marked do-not-text. Send by email instead.' }, { status: 400 })
  }
  const email = ((contact.email as string | null) ?? '').trim()
  if (channels.includes('email')) {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'This customer has no email address on file.' }, { status: 400 })
    const { data: sup } = await admin.from('email_suppressions').select('reason')
      .eq('company_id', c.companyId).in('email', Array.from(new Set([email, email.toLowerCase()]))).in('reason', ['bounce', 'complaint']).limit(1)
    if (sup && sup.length > 0) {
      return NextResponse.json({
        error: sup[0].reason === 'bounce'
          ? 'Email to this address has bounced before, so it won’t be sent. Send by text instead.'
          : 'This customer marked our email as spam, so it won’t be sent. Send by text instead.',
      }, { status: 400 })
    }
  }

  const now = new Date()
  const expiresAt = isResend ? (q.expires_at as string) : expiryFrom(now)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com'
  const url = `${baseUrl}/quote/${q.share_token}`
  const profile = await getBusinessProfile(admin, c.companyId)
  const first = ((contact.first_name as string | null) || contactDisplayName(contact)).trim().split(/\s+/)[0] || ''
  const title = String(q.title).trim()
  const total = quoteTotals(items).required
  const until = new Date(expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

  const results: { text?: { ok: boolean; error?: string }; email?: { ok: boolean; error?: string } } = {}

  if (channels.includes('text')) {
    const r = await sendDirectTxtToPhone({
      admin,
      companyId: c.companyId,
      userId: c.userId,
      phone: contact.phone as string,
      name: contact.name as string | null,
      body: `${first ? `Hi ${first}, ` : ''}here's your quote from ${profile.businessName}: ${title}. You can review it, choose any add-ons and approve it here: ${url}`,
    })
    results.text = r.ok ? { ok: true } : { ok: false, error: r.error || 'Text failed' }
  }

  if (channels.includes('email')) {
    const identity = await resolveSendIdentity(admin, c.companyId)
    if (!identity) {
      results.email = { ok: false, error: 'No email sending address is set up for the company.' }
    } else {
      const biz = esc(profile.businessName)
      const html = `<!doctype html><html><body style="margin:0;background:#eef2f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#16211e">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#fff;border-radius:14px;overflow:hidden">
<div style="background:#2f6b3a;color:#fff;padding:20px">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">${biz}</div>
<div style="font-size:20px;font-weight:600;margin-top:4px">${esc(title)}</div>
</div>
<div style="padding:20px;font-size:15px;line-height:1.6">
<p style="margin:0 0 12px">${first ? `Hi ${esc(first)},` : 'Hello,'}</p>
<p style="margin:0 0 16px">Thanks for considering us. Your quote is ready${total > 0 ? ` (${esc(money(total))})` : ''} — you can review the details, choose any optional add-ons and approve it online. It’s good until ${esc(until)}.</p>
<p style="margin:0 0 20px"><a href="${esc(url)}" style="display:inline-block;background:#2f6b3a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">View your quote</a></p>
<p style="margin:0;color:#5a6b64;font-size:13px">Questions? Just reply to this email or call us at ${esc(profile.phone)}.</p>
</div>
</div>
<div style="text-align:center;color:#5a6b64;font-size:12px;padding:12px">${biz}${identity.physical_address ? ` · ${esc(identity.physical_address)}` : ''}</div>
</div></body></html>`
      const text = `${first ? `Hi ${first},` : 'Hello,'}\n\nYour quote from ${profile.businessName} is ready: ${title}${total > 0 ? ` (${money(total)})` : ''}. Review it, choose any add-ons and approve it here (good until ${until}):\n\n${url}\n\nQuestions? Reply to this email or call us at ${profile.phone}.\n\n${profile.businessName}`
      const r = await sendEmail({
        from: formatFrom(identity.from_name, identity.from_email),
        replyTo: identity.reply_to ?? undefined,
        to: email,
        subject: `Your quote from ${profile.businessName} — ${title}`,
        html,
        text,
        tags: [{ name: 'kind', value: 'quote' }],
      })
      results.email = r.ok ? { ok: true } : { ok: false, error: r.error === 'resend_not_configured' ? 'Email isn’t set up on this server.' : r.error }
    }
  }

  const sent = (Object.entries(results) as ['text' | 'email', { ok: boolean }][]).filter(([, r]) => r.ok).map(([k]) => k)
  if (sent.length > 0) {
    const prior = (q.sent_via as string[] | null) ?? []
    const up: Record<string, unknown> = { sent_via: Array.from(new Set([...prior, ...sent])), updated_at: now.toISOString(), updated_by: c.userId }
    if (!isResend) Object.assign(up, { status: 'sent', sent_at: now.toISOString(), expires_at: expiresAt, salesperson_user_id: c.userId })
    await admin.from('quotes').update(up).eq('id', id).eq('company_id', c.companyId)
    await admin.from('quote_events').insert({ quote_id: id, company_id: c.companyId, kind: isResend ? 'resent' : 'sent', actor_user_id: c.userId, meta: { via: sent } })
    // First send (or re-send after a Revise): mirror into Jobber — after the
    // response, so the tech isn't kept waiting. (Moving the Lead Tracker card
    // is on hold — Ben, Oct 6 2026.)
    if (!isResend) {
      const companyId = c.companyId, userId = c.userId
      after(() => jobberStepInBackground(companyId, id, 'send', admin => pushQuoteToJobber(admin, companyId, id, userId)))
    }
  }

  const failed = (Object.entries(results) as ['text' | 'email', { ok: boolean; error?: string }][]).filter(([, r]) => !r.ok)
  return NextResponse.json(
    { ok: sent.length > 0, sent, url, expiresAt, error: failed.length > 0 ? failed.map(([k, r]) => `${k === 'text' ? 'Text' : 'Email'}: ${r.error}`).join(' · ') : undefined },
    { status: sent.length > 0 ? 200 : 502 },
  )
}
