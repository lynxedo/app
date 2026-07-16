// Campaign send helpers: CAN-SPAM compliance footer + RFC-8058 one-click
// List-Unsubscribe headers, and the one shared "render merge + footer + send"
// path used by BOTH the campaign drainer and the automation engine — so the
// compliance wrapping can never drift between the two. The unsubscribe token is
// the signed HMAC from lib/email-unsubscribe.
import type { SupabaseClient } from '@supabase/supabase-js'
import { signUnsubToken } from '@/lib/email-unsubscribe'
import { sendEmail, formatFrom, type ResendSendResult } from '@/lib/resend'
import { renderMergeFields } from '@/lib/email-markdown'
import { getEmailAudience, normalizeEmail, type EmailAudienceRow } from '@/lib/email-contacts'
import { resolveSegment, normalizeFilter } from '@/lib/email-segments'
import { normalizeDesign, renderDesignToHtml, type EmailDesign } from '@/lib/email-blocks'

type Admin = SupabaseClient<any, any, any>

/**
 * The audience picks for a campaign, persisted on email_campaigns.audience so a
 * draft round-trips and a sent campaign records what it targeted. A campaign can
 * combine ANY of these — segments, hand-picked contacts, and typed-in addresses —
 * and the resolver below merges them, de-duplicated by email, so nobody gets the
 * same campaign twice.
 *   everyone       — all subscribed, non-suppressed directory contacts (supersedes segment_ids)
 *   segment_ids    — saved segments; their audiences are UNIONed
 *   contact_ids    — directory contact ids hand-picked from the emailable audience
 *   extra_emails   — addresses typed in by hand that are NOT directory contacts (one-off sends)
 *   excluded_ids   — directory contact ids to drop from the resolved list (per-send review)
 */
export type AudienceSpec = {
  everyone?: boolean
  segment_ids?: string[]
  contact_ids?: string[]
  extra_emails?: string[]
  excluded_ids?: string[]
}

export type CampaignRecipient = {
  contact_id: string | null
  email: string
  first_name: string | null
  last_name: string | null
}

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))] : []

/** Coerce arbitrary request JSON into a clean AudienceSpec (back-compat: a single
 *  `segment_id` string folds into segment_ids). */
export function normalizeAudienceSpec(body: Record<string, unknown>): AudienceSpec {
  const segmentIds = strArr(body.segment_ids)
  const legacy = typeof body.segment_id === 'string' && body.segment_id ? [body.segment_id] : []
  return {
    everyone: body.everyone === true,
    segment_ids: [...new Set([...segmentIds, ...legacy])],
    contact_ids: strArr(body.contact_ids),
    extra_emails: strArr(body.extra_emails).map((e) => e.trim()).filter(Boolean),
    excluded_ids: strArr(body.excluded_ids),
  }
}

/**
 * Resolve an AudienceSpec to the final, de-duplicated recipient list. Directory
 * contacts (everyone / segments / picks) are matched against getEmailAudience, so
 * they're already subscribed + non-suppressed; typed-in addresses bypass the
 * directory but are still suppression-checked at SEND time by the drainer. Dedup
 * key is the lowercased email — a contact present in two segments, or typed in by
 * hand AND in a segment, appears once (the contact row wins so we keep the name).
 */
export async function resolveCampaignAudience(
  admin: Admin,
  companyId: string,
  spec: AudienceSpec,
): Promise<CampaignRecipient[]> {
  const byEmail = new Map<string, CampaignRecipient>()
  const excluded = new Set(spec.excluded_ids ?? [])

  const addContact = (r: EmailAudienceRow) => {
    if (!r.email || excluded.has(r.id)) return
    const key = r.email.toLowerCase()
    if (!byEmail.has(key)) {
      byEmail.set(key, { contact_id: r.id, email: r.email, first_name: r.first_name, last_name: r.last_name })
    }
  }

  // Directory contacts from "everyone" or the union of selected segments.
  if (spec.everyone) {
    ;(await getEmailAudience(admin, companyId)).forEach(addContact)
  } else if (spec.segment_ids?.length) {
    const { data: segs } = await admin
      .from('email_segments')
      .select('id, filter')
      .eq('company_id', companyId)
      .in('id', spec.segment_ids)
    for (const seg of segs ?? []) {
      ;(await resolveSegment(admin, companyId, normalizeFilter(seg.filter))).forEach(addContact)
    }
  }

  // Hand-picked contacts (intersected with the emailable audience so suppressed /
  // unsubscribed picks can never slip through).
  if (spec.contact_ids?.length) {
    const picked = new Set(spec.contact_ids)
    ;(await getEmailAudience(admin, companyId)).filter((r) => picked.has(r.id)).forEach(addContact)
  }

  // Typed-in addresses that aren't directory contacts → one-off recipients. Only
  // added if a contact with that same email isn't already in the list.
  for (const raw of spec.extra_emails ?? []) {
    const e = normalizeEmail(raw)
    if (e && !byEmail.has(e)) byEmail.set(e, { contact_id: null, email: e, first_name: null, last_name: null })
  }

  return [...byEmail.values()]
}

/**
 * Resolve a campaign's email content (subject + email-safe HTML snapshot). The
 * compose flow sends the edited design + subject directly; template_id, when
 * present, is provenance ("started from this template") and also a fallback
 * source when no design/subject was sent (back-compat "send as-is"). The HTML is
 * snapshotted so later template edits never change a sent/queued campaign.
 */
export async function buildCampaignContent(
  admin: Admin,
  companyId: string,
  body: Record<string, unknown>,
  baseUrl: string,
): Promise<
  | { ok: true; templateId: string | null; design: EmailDesign; subject: string; bodyHtml: string; sourceName: string }
  | { ok: false; status: number; error: string }
> {
  const templateId = typeof body.template_id === 'string' && body.template_id ? body.template_id : null
  let design = normalizeDesign(body.design)
  let subject = String(body.subject || '').trim()
  let sourceName = 'Campaign'

  if (templateId) {
    const { data: tpl } = await admin
      .from('email_templates')
      .select('id, name, subject, design')
      .eq('company_id', companyId)
      .eq('id', templateId)
      .maybeSingle()
    if (!tpl) return { ok: false, status: 404, error: 'Template not found' }
    sourceName = tpl.name
    if (!design.blocks.length) design = normalizeDesign(tpl.design)
    if (!subject) subject = String(tpl.subject || '').trim()
  }

  const bodyHtml = design.blocks.length ? renderDesignToHtml(design, { baseUrl }) : ''
  return { ok: true, templateId, design, subject, bodyHtml, sourceName }
}

/** Insert one queued recipient row per resolved recipient, chunked. Returns the
 *  first error (the caller deletes the half-built campaign on failure). */
export async function enqueueCampaignRecipients(
  admin: Admin,
  campaignId: string,
  recipients: CampaignRecipient[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = recipients.map((r) => ({
    campaign_id: campaignId,
    contact_id: r.contact_id,
    email: r.email,
    first_name: r.first_name,
    last_name: r.last_name,
    status: 'queued' as const,
  }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('email_campaign_recipients').insert(rows.slice(i, i + 500))
    if (error) return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** A short, human label for a campaign's audience, used when auto-naming. */
export function describeAudience(spec: AudienceSpec, segmentNames: string[]): string {
  if (spec.everyone) return 'Everyone'
  const parts: string[] = []
  if (segmentNames.length === 1) parts.push(segmentNames[0])
  else if (segmentNames.length > 1) parts.push(`${segmentNames.length} segments`)
  if (spec.contact_ids?.length) parts.push(`${spec.contact_ids.length} picked`)
  if (spec.extra_emails?.length) parts.push(`${spec.extra_emails.length} typed`)
  return parts.length ? parts.join(' + ') : 'Selected recipients'
}

export type EmailSendIdentity = {
  from_name: string | null
  from_email: string
  reply_to: string | null
  physical_address: string | null
}

/**
 * Render a snapshot subject/HTML for one recipient (fill {{merge}} + append the
 * CAN-SPAM footer with a campaign-attributed unsubscribe link) and send it via
 * Resend with one-click List-Unsubscribe headers. Used by campaigns
 * (tagValue 'campaign') and automation steps ('automation').
 */
export async function renderAndSendEmail(opts: {
  identity: EmailSendIdentity
  baseUrl: string
  companyId: string
  email: string
  firstName: string | null
  lastName: string | null
  subject: string
  bodyHtml: string
  unsubCampaignId?: string | null
  tagValue: 'campaign' | 'automation' | 'drip'
}): Promise<ResendSendResult> {
  const merge = { first_name: opts.firstName, last_name: opts.lastName, email: opts.email }
  const subject = renderMergeFields(opts.subject || '', merge)
  const unsub = unsubscribeUrls(opts.baseUrl, opts.companyId, opts.email, opts.unsubCampaignId)
  const html = appendComplianceFooter(renderMergeFields(opts.bodyHtml || '', merge), {
    brand: opts.identity.from_name || '',
    physicalAddress: opts.identity.physical_address,
    unsubscribeLink: unsub.link,
  })
  return sendEmail({
    from: formatFrom(opts.identity.from_name, opts.identity.from_email),
    to: opts.email,
    replyTo: opts.identity.reply_to || undefined,
    subject,
    html,
    headers: listUnsubscribeHeaders(unsub.oneClick),
    tags: [{ name: 'type', value: opts.tagValue }],
  })
}

function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * The human-facing unsubscribe URL (lands on the friendly /unsubscribe page) and
 * the one-click POST target (RFC-8058). Both carry the same signed token.
 */
export function unsubscribeUrls(
  baseUrl: string,
  companyId: string,
  email: string,
  campaignId?: string | null,
): { link: string; oneClick: string } {
  const origin = (baseUrl || '').replace(/\/$/, '')
  const token = encodeURIComponent(signUnsubToken(companyId, email, campaignId))
  return {
    link: `${origin}/unsubscribe?token=${token}`,
    oneClick: `${origin}/api/email/unsubscribe?token=${token}`,
  }
}

/**
 * Headers every marketing send must carry so Gmail/Apple Mail show a native
 * "Unsubscribe" affordance and honor one-click (RFC 8058). reply_to is set
 * separately on the Resend call.
 */
export function listUnsubscribeHeaders(oneClickUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${oneClickUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

/**
 * Inject the CAN-SPAM footer (sender brand + physical mailing address +
 * one-click unsubscribe link) into a rendered email document, right before
 * </body>. Falls back to appending if the marker isn't present. The physical
 * address is legally required for marketing email; the caller warns when it's
 * unset, but we still render a complete, unsubscribe-bearing footer.
 */
export function appendComplianceFooter(
  html: string,
  opts: { brand: string; physicalAddress: string | null | undefined; unsubscribeLink: string },
): string {
  const addr = (opts.physicalAddress || '').trim()
  const footer = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:transparent">
<tr><td align="center" style="padding:18px 12px 28px">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#9ca3af;max-width:600px;margin:0 auto">
${opts.brand ? `<div style="color:#6b7280">${esc(opts.brand)}</div>` : ''}
${addr ? `<div>${esc(addr)}</div>` : ''}
<div style="margin-top:6px">
You're receiving this because you're a customer or contact.
<a href="${esc(opts.unsubscribeLink)}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a>
</div>
</div>
</td></tr>
</table>`
  if (html.includes('</body>')) return html.replace('</body>', `${footer}\n</body>`)
  return html + footer
}
