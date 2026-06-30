import crypto from 'node:crypto'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER || ''
// A2P 10DLC: when we send from our registered long code, route through the
// Messaging Service that holds the verified campaign. Carriers (especially
// AT&T) deliver registered-campaign traffic far more reliably, and the service
// paces throughput automatically. Other numbers (e.g. the toll-free) keep
// sending by raw From. Empty MESSAGING_SERVICE_SID = behave exactly as before.
const MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID || ''
// The specific number the Messaging Service / A2P campaign is registered for.
// We only route a send through the service when it's going out on THIS number.
// Set explicitly (not just the env From) because the default From can differ
// per environment — e.g. staging's default From is the toll-free line.
const A2P_NUMBER = process.env.TWILIO_A2P_NUMBER || FROM_NUMBER

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
  fromNumber?: string
  messagingServiceSid?: string
}): Promise<TwilioSendResult> {
  if (!twilioConfigured()) {
    return { ok: false, error: 'twilio_not_configured' }
  }

  const from = opts.fromNumber || FROM_NUMBER
  const form = new URLSearchParams()
  // Prefer the Messaging Service for our A2P long code (registered campaign →
  // better AT&T/10DLC delivery + automatic throughput). An explicit
  // opts.messagingServiceSid wins; otherwise auto-route when sending from our
  // default A2P number. Anything else (toll-free, etc.) still sends by From.
  const serviceSid =
    opts.messagingServiceSid ||
    (MESSAGING_SERVICE_SID && from === A2P_NUMBER ? MESSAGING_SERVICE_SID : '')
  if (serviceSid) {
    form.set('MessagingServiceSid', serviceSid)
  } else {
    form.set('From', from)
  }
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

// ---------------------------------------------------------------------------
// Conversations API (used for group SMS). Separate Twilio product from
// Programmable Messaging. Group conversations are first-class Twilio resources:
// you create a Conversation, add Participants (each with their phone +
// proxy_address = our Twilio number), then send Messages on the Conversation.
// Inbound + status events fire on the Conversations Service webhook,
// not the per-number SMS webhook.
//
// All helpers below no-op safely when creds are empty — same pattern as
// sendSms — so the code paths can run on staging without configured creds.
// ---------------------------------------------------------------------------

export type TwilioConvCreateResult =
  | { ok: true; sid: string }
  | { ok: false; error: string; code?: number }

async function twilioConvFetch(path: string, init: RequestInit) {
  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')
  return fetch(`https://conversations.twilio.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(init.headers || {}),
    },
  })
}

export async function twilioConvCreate(opts: {
  friendlyName?: string
}): Promise<TwilioConvCreateResult> {
  if (!twilioConfigured()) return { ok: false, error: 'twilio_not_configured' }
  const form = new URLSearchParams()
  if (opts.friendlyName) form.set('FriendlyName', opts.friendlyName)
  const res = await twilioConvFetch('/Conversations', {
    method: 'POST',
    body: form.toString(),
  })
  const payload = (await res.json().catch(() => null)) as
    | { sid?: string; message?: string; code?: number }
    | null
  if (!res.ok || !payload?.sid) {
    return {
      ok: false,
      error: payload?.message || `twilio_http_${res.status}`,
      code: payload?.code,
    }
  }
  return { ok: true, sid: payload.sid }
}

export async function twilioConvAddSmsParticipant(opts: {
  conversationSid: string
  contactPhone: string // E.164
  proxyNumber?: string // overrides env default; for Session 54 multi-number
}): Promise<{ ok: boolean; error?: string }> {
  if (!twilioConfigured()) return { ok: false, error: 'twilio_not_configured' }
  const form = new URLSearchParams()
  form.set('MessagingBinding.Address', opts.contactPhone)
  form.set('MessagingBinding.ProxyAddress', opts.proxyNumber || FROM_NUMBER)
  const res = await twilioConvFetch(
    `/Conversations/${opts.conversationSid}/Participants`,
    { method: 'POST', body: form.toString() }
  )
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as
      | { message?: string }
      | null
    return { ok: false, error: payload?.message || `twilio_http_${res.status}` }
  }
  return { ok: true }
}

// Attach a CONVERSATION-SCOPED inbound webhook so participant replies POST to
// this environment's handler. We deliberately use a per-conversation webhook
// (not the account-global Conversations webhook) because staging + prod share
// ONE Twilio account — a global URL would send every env's group events to
// whichever env was configured last. Scoping to the conversation created here
// means staging groups call staging, prod groups call prod. Filter to
// onMessageAdded (participant inbound). Best-effort: a failure here just means
// replies won't appear in-app; the outbound group still works.
export async function twilioConvAddWebhook(opts: {
  conversationSid: string
  url: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!twilioConfigured()) return { ok: false, error: 'twilio_not_configured' }
  const form = new URLSearchParams()
  form.set('Target', 'webhook')
  form.set('Configuration.Url', opts.url)
  form.set('Configuration.Method', 'POST')
  form.set('Configuration.Filters', 'onMessageAdded')
  const res = await twilioConvFetch(
    `/Conversations/${opts.conversationSid}/Webhooks`,
    { method: 'POST', body: form.toString() }
  )
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { message?: string } | null
    return { ok: false, error: payload?.message || `twilio_http_${res.status}` }
  }
  return { ok: true }
}

export async function twilioConvSendMessage(opts: {
  conversationSid: string
  body: string
  author?: string
}): Promise<TwilioSendResult> {
  if (!twilioConfigured()) return { ok: false, error: 'twilio_not_configured' }
  const form = new URLSearchParams()
  form.set('Body', opts.body)
  if (opts.author) form.set('Author', opts.author)
  const res = await twilioConvFetch(
    `/Conversations/${opts.conversationSid}/Messages`,
    { method: 'POST', body: form.toString() }
  )
  const payload = (await res.json().catch(() => null)) as
    | { sid?: string; message?: string; code?: number }
    | null
  if (!res.ok || !payload?.sid) {
    return {
      ok: false,
      error: payload?.message || `twilio_http_${res.status}`,
      code: payload?.code,
    }
  }
  return { ok: true, sid: payload.sid, status: 'queued' }
}

// E.164 normalizer for US numbers — single source of truth in lib/phone.ts,
// re-exported here so existing `import { toE164 } from '@/lib/twilio'` callers
// keep working.
export { toE164, isShortCode, normalizeSmsDestination } from './phone'
