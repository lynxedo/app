// Campaign send helpers: CAN-SPAM compliance footer + RFC-8058 one-click
// List-Unsubscribe headers. Shared by the campaign process cron (and reusable by
// the future automation engine in Sessions 6–7). Dependency-free; the unsubscribe
// token is the signed HMAC from lib/email-unsubscribe.
import { signUnsubToken } from '@/lib/email-unsubscribe'

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
