import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { suppressEmail } from '@/lib/email-contacts'
import { mapResendType } from '@/lib/email-events'

// Resend event webhook (Session 5). Resend delivers via Svix, so requests carry
// svix-id / svix-timestamp / svix-signature headers signed with the endpoint's
// signing secret (RESEND_WEBHOOK_SECRET, "whsec_..."). We verify that signature,
// then log the event to email_events and auto-suppress hard bounces + complaints.
//
// Configure in the Resend dashboard at prod cutover: add a webhook pointing at
// https://lynxedo.com/api/email/resend-webhook for events email.delivered /
// .opened / .clicked / .bounced / .complained, and put its signing secret in the
// prod .env.local as RESEND_WEBHOOK_SECRET.

export const runtime = 'nodejs'

const TOLERANCE_MS = 5 * 60 * 1000

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

// Svix signature verification (https://docs.svix.com/receiving/verifying-payloads/how-manual).
function verifySvix(rawBody: string, headers: Headers, secret: string): boolean {
  const id = headers.get('svix-id')
  const timestamp = headers.get('svix-timestamp')
  const signature = headers.get('svix-signature')
  if (!id || !timestamp || !signature) return false

  // Replay window.
  const ts = Number(timestamp) * 1000
  if (Number.isFinite(ts) && Math.abs(Date.now() - ts) > TOLERANCE_MS) return false

  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64')
  const signed = `${id}.${timestamp}.${rawBody}`
  const expected = crypto.createHmac('sha256', key).update(signed).digest('base64')
  // Header is a space-separated list of "v1,<sig>" entries; any match passes.
  return signature.split(' ').some((part) => {
    const [, value] = part.split(',')
    return value ? safeEqual(value, expected) : false
  })
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    // Not wired yet (e.g. staging before cutover). Be explicit rather than
    // silently accepting unverified events.
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 })
  }

  const rawBody = await request.text()
  if (!verifySvix(rawBody, request.headers, secret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  const type = mapResendType(payload?.type)
  if (!type) return NextResponse.json({ ok: true, ignored: payload?.type ?? 'unknown' })

  const data = payload?.data ?? {}
  const messageId: string | null = data.email_id || data.id || null
  const toRaw = Array.isArray(data.to) ? data.to[0] : data.to
  const email: string | null = typeof toRaw === 'string' ? toRaw.toLowerCase() : null
  const occurredAt = typeof payload?.created_at === 'string' ? payload.created_at : new Date().toISOString()
  const url: string | null = type === 'clicked' ? (data?.click?.link || null) : null
  const eventId = request.headers.get('svix-id')

  const admin = createAdminClient()

  // Match the send back to its campaign recipient (campaign sends tag every
  // message with provider_message_id). Unmatched events (test sends, future
  // automation) still log with null campaign/company.
  let campaignId: string | null = null
  let recipientId: string | null = null
  let companyId: string | null = null
  if (messageId) {
    const { data: rec } = await admin
      .from('email_campaign_recipients')
      .select('id, campaign_id')
      .eq('provider_message_id', messageId)
      .maybeSingle()
    if (rec) {
      recipientId = rec.id
      campaignId = rec.campaign_id
      const { data: camp } = await admin
        .from('email_campaigns')
        .select('company_id')
        .eq('id', rec.campaign_id)
        .maybeSingle()
      companyId = camp?.company_id ?? null
    }
  }

  // Idempotent insert: plain insert + swallow 23505 (the partial unique index on
  // (event_id, type) can't be targeted by a PostgREST upsert onConflict — that
  // raises 42P10 — so we let a Svix retry hit the constraint and ignore it).
  const { error: insErr } = await admin
    .from('email_events')
    .insert({
      company_id: companyId,
      campaign_id: campaignId,
      recipient_id: recipientId,
      email,
      provider_message_id: messageId,
      type,
      url,
      occurred_at: occurredAt,
      event_id: eventId,
      raw: payload,
    })
  if (insErr && insErr.code === '23505') {
    return NextResponse.json({ ok: true, type, duplicate: true })
  }

  // Reputation protection: hard bounce or spam complaint => suppress forever.
  if ((type === 'bounced' || type === 'complained') && companyId && email) {
    await suppressEmail(admin, companyId, email, type === 'bounced' ? 'bounce' : 'complaint')
  }

  return NextResponse.json({ ok: true, type })
}
