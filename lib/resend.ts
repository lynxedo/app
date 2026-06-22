// Resend email provider wrapper. Mirrors lib/twilio.ts: a thin raw-fetch client
// against the Resend REST API (https://resend.com/docs/api-reference), no SDK
// dependency. The marketing module reads the per-company sending identity from
// the email_settings table (NOT hardcoded) and passes `from`/`replyTo` here.
//
// Env: RESEND_API_KEY (add to staging + prod .env.local). Until it's set,
// resendConfigured() is false and sends return { ok: false, error: 'resend_not_configured' }.

const API_KEY = process.env.RESEND_API_KEY || ''
const API_BASE = 'https://api.resend.com'

export function resendConfigured(): boolean {
  return Boolean(API_KEY)
}

export type ResendSendResult =
  | { ok: true; id: string }
  | { ok: false; error: string; status?: number }

/**
 * Send a single email. `from` must be on a domain verified in Resend
 * (e.g. "Heroes Lawn Care of The Woodlands <hlc105@heroeslawntx.com>").
 */
export async function sendEmail(opts: {
  from: string
  to: string | string[]
  subject: string
  html?: string
  text?: string
  replyTo?: string
  headers?: Record<string, string>
  tags?: { name: string; value: string }[]
}): Promise<ResendSendResult> {
  if (!resendConfigured()) {
    return { ok: false, error: 'resend_not_configured' }
  }
  if (!opts.html && !opts.text) {
    return { ok: false, error: 'missing_body' }
  }

  try {
    const res = await fetch(`${API_BASE}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: opts.from,
        to: Array.isArray(opts.to) ? opts.to : [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        reply_to: opts.replyTo,
        headers: opts.headers,
        tags: opts.tags,
      }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || `resend_http_${res.status}`
      return { ok: false, error: String(msg), status: res.status }
    }
    return { ok: true, id: data.id as string }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'resend_request_failed' }
  }
}

export type ResendDomainStatus =
  | { ok: true; id: string; name: string; status: string; records?: unknown[] }
  | { ok: false; error: string; status?: number }

/**
 * Look up a Resend domain's verification status by its domain id. Used by the
 * admin panel's "refresh status" button to sync email_settings.domain_verified.
 * Resend statuses: 'not_started' | 'pending' | 'verified' | 'failure' | 'temporary_failure'.
 */
export async function getDomainStatus(domainId: string): Promise<ResendDomainStatus> {
  if (!resendConfigured()) return { ok: false, error: 'resend_not_configured' }
  try {
    const res = await fetch(`${API_BASE}/domains/${domainId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || `resend_http_${res.status}`
      return { ok: false, error: String(msg), status: res.status }
    }
    return { ok: true, id: data.id, name: data.name, status: data.status, records: data.records }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'resend_request_failed' }
  }
}

/** Compose an RFC-5322 From header from a display name + address. */
export function formatFrom(name: string | null | undefined, email: string): string {
  return name ? `${name} <${email}>` : email
}
