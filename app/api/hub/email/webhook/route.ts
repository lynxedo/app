import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { nylasConfigured, nylasWebhookSecret } from '@/lib/inbox/config'
import { verifyNylasSignature, type NylasNotification } from '@/lib/inbox/webhook'
import { recordRawEvent, processInboxEvent } from '@/lib/inbox/webhook-handlers'

export const dynamic = 'force-dynamic'

// Nylas v3 webhook endpoint for the Shared Inbox — the event-driven replacement for the
// polling sync. Nylas expects a FAST 200, so the heavy mirror work runs in after().
//
//   GET  ?challenge=… → echo the challenge back as text/plain (Nylas registration handshake).
//   GET  (no challenge) → tiny health payload.
//   POST → verify X-Nylas-Signature (HMAC-SHA256 of the raw body), record the raw event
//          for idempotency, then dispatch post-response.

// Nylas subscription handshake: it registers the URL by GETting ?challenge=<value> and
// requires the raw challenge value echoed back (text/plain), nothing else.
export async function GET(request: NextRequest) {
  const challenge = request.nextUrl.searchParams.get('challenge')
  if (challenge !== null) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return NextResponse.json({ ok: true, endpoint: 'hub/email/webhook', configured: nylasConfigured() })
}

export async function POST(request: NextRequest) {
  // Read the RAW body first — signature verification must run over the exact bytes we
  // received, never a re-serialized object.
  const raw = await request.text()

  // Verify the signature when the secret is configured. When it is unset the whole
  // feature is dark: we skip verification (and just log) so a misconfig never 500s.
  const secret = nylasWebhookSecret()
  if (secret) {
    const sig = request.headers.get('x-nylas-signature')
    if (!verifyNylasSignature(raw, sig, secret)) {
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
    }
  } else {
    console.warn('[inbox:webhook] NYLAS_WEBHOOK_SECRET unset — skipping signature verification (dark/safe)')
  }

  let notification: NylasNotification
  try {
    notification = JSON.parse(raw) as NylasNotification
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!notification || typeof notification.type !== 'string' || typeof notification.id !== 'string') {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Idempotency: dedupe redelivery on (provider, event_id) before doing any work.
  const { isNew } = await recordRawEvent(admin, notification)
  if (!isNew) {
    return NextResponse.json({ ok: true, duplicate: true })
  }

  // Heavy mirror work runs after the response so Nylas gets its fast 200. processInboxEvent
  // never throws — a poisoned event is recorded as status='error', not surfaced here.
  after(async () => {
    await processInboxEvent(admin, notification)
  })

  return NextResponse.json({ ok: true })
}
