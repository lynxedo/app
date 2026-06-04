import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { processJobberWebhookEvent } from '@/lib/jobber-sync'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Single-tenant: Heroes Lawn Care. When Lynxedo onboards more companies, map the
// webhook's base64 accountId → company_id here instead.
const COMPANY_ID = '00000000-0000-0000-0000-000000000002'

/**
 * Jobber signs each webhook with HMAC-SHA256 over the raw body, keyed by the
 * app's OAuth client secret, delivered base64-encoded in X-Jobber-Hmac-SHA256.
 * (Confirmed against developer.getjobber.com — the signing key is the client
 * secret, NOT a separate webhook secret, and the digest is base64, not hex.)
 */
function verifyJobberSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.JOBBER_CLIENT_SECRET
  if (!secret || !signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const sig = req.headers.get('X-Jobber-Hmac-SHA256') ?? ''

  if (!verifyJobberSignature(raw, sig)) {
    return new NextResponse('invalid signature', { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return new NextResponse('bad json', { status: 400 })
  }

  const evt = (payload as {
    data?: { webHookEvent?: { topic?: string; itemId?: string; accountId?: string; occurredAt?: string; occuredAt?: string } }
  })?.data?.webHookEvent

  // Acknowledge anything we can't parse so Jobber doesn't retry forever.
  if (!evt?.topic || !evt?.itemId) {
    console.warn('[jobber-webhook] unrecognized payload shape, acking')
    return new NextResponse('ok', { status: 200 })
  }

  // `occuredAt` is the legacy spelling on apps created before 2023-12-08.
  const occurredAt = evt.occurredAt ?? evt.occuredAt ?? null

  // Acknowledge fast (Jobber wants 200 within seconds); process in background.
  void processJobberWebhookEvent({ topic: evt.topic, itemId: evt.itemId, companyId: COMPANY_ID, occurredAt })
    .catch(err => console.error('[jobber-webhook]', evt.topic, evt.itemId, err))

  return new NextResponse('ok', { status: 200 })
}

// Lightweight liveness check (Jobber never GETs this; handy for deploy verification).
export async function GET() {
  return NextResponse.json({ ok: true, configured: Boolean(process.env.JOBBER_CLIENT_SECRET) })
}
