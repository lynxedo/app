// Campaign send helpers: CAN-SPAM compliance footer + RFC-8058 one-click
// List-Unsubscribe headers, and the one shared "render merge + footer + send"
// path used by BOTH the campaign drainer and the automation engine — so the
// compliance wrapping can never drift between the two. The unsubscribe token is
// the signed HMAC from lib/email-unsubscribe.
import { signUnsubToken } from '@/lib/email-unsubscribe'
import { sendEmail, formatFrom, type ResendSendResult } from '@/lib/resend'
import { renderMergeFields } from '@/lib/email-markdown'

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
  tagValue: 'campaign' | 'automation'
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
