import crypto from 'node:crypto'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER || ''

export function twilioConfigured(): boolean {
  return Boolean(ACCOUNT_SID && AUTH_TOKEN && FROM_NUMBER)
}

export function twilioFromNumber(): string {
  return FROM_NUMBER
}

export type TwilioSendResult =
  | { ok: true; sid: string; status: string }
  | { ok: false; error: string; code?: number }

export async function sendSms(opts: {
  to: string
  body: string
  mediaUrls?: string[]
  statusCallback?: string
}): Promise<TwilioSendResult> {
  if (!twilioConfigured()) {
    return { ok: false, error: 'twilio_not_configured' }
  }

  const form = new URLSearchParams()
  form.set('From', FROM_NUMBER)
  form.set('To', opts.to)
  if (opts.body) form.set('Body', opts.body)
  if (opts.mediaUrls?.length) {
    for (const url of opts.mediaUrls) form.append('MediaUrl', url)
  }
  if (opts.statusCallback) form.set('StatusCallback', opts.statusCallback)

  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    }
  )

  const payload = (await res.json().catch(() => null)) as
    | { sid?: string; status?: string; message?: string; code?: number }
    | null

  if (!res.ok || !payload?.sid) {
    return {
      ok: false,
      error: payload?.message || `twilio_http_${res.status}`,
      code: payload?.code,
    }
  }

  return { ok: true, sid: payload.sid, status: payload.status || 'queued' }
}

// Twilio signature validation. Returns true if signature header is present
// and matches; returns false otherwise. Throws nothing.
// https://www.twilio.com/docs/usage/security#validating-requests
export function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  headerSignature: string | null
): boolean {
  if (!AUTH_TOKEN || !headerSignature) return false
  const sortedKeys = Object.keys(params).sort()
  let data = url
  for (const key of sortedKeys) data += key + params[key]
  const computed = crypto
    .createHmac('sha1', AUTH_TOKEN)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64')
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed),
      Buffer.from(headerSignature)
    )
  } catch {
    return false
  }
}

// Helper to download a Twilio MediaUrl with auth. Returns raw bytes + content-type.
export async function downloadTwilioMedia(
  mediaUrl: string
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!twilioConfigured()) return null
  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')
  const res = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${auth}` },
    redirect: 'follow',
  })
  if (!res.ok) return null
  const buffer = await res.arrayBuffer()
  return {
    bytes: new Uint8Array(buffer),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  }
}

// E.164 normalizer for US numbers — Twilio requires E.164 (+1...).
// Accepts (281) 555-1234, 281-555-1234, 12815551234, +12815551234, etc.
export function toE164(raw: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '')
    return digits.length >= 10 ? '+' + digits : null
  }
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  return null
}
