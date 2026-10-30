import { NextRequest, NextResponse, after } from 'next/server'
import crypto from 'crypto'
import { resolveCompanyByJobberAccountId } from '@/lib/jobber-sync'
import { drainJobberWebhookQueue, enqueueJobberWebhookEvent } from '@/lib/jobber-webhook-queue'
import { configuredJobberApps } from '@/lib/jobber-apps'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Multi-tenant Track 3 — the fallback company when an event's Jobber accountId
// can't be mapped to a tenant (unknown/unmapped account, or Heroes before its
// accountId is backfilled). Env-overridable but defaults to Heroes Lawn Care so
// the single-tenant path stays byte-identical during the SaaS transition.
// ⚠ TRANSITION-ONLY: once every tenant's accountId is mapped in jobber_tokens,
// an unmapped/absent accountId should be REJECTED (ack-and-drop) rather than
// silently attributed to Heroes. DO NOT reject yet — the fallback is what keeps
// Heroes' events flowing while account mapping is backfilled.
const HEROES_FALLBACK_COMPANY_ID =
  process.env.JOBBER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

/**
 * Jobber signs each webhook with HMAC-SHA256 over the raw body, keyed by the
 * app's OAuth client secret, delivered base64-encoded in X-Jobber-Hmac-SHA256.
 * (Confirmed against developer.getjobber.com — the signing key is the client
 * secret, NOT a separate webhook secret, and the digest is base64, not hex.)
 *
 * Two Jobber apps post here — the original Lynxedo app (Heroes) and the Servanto
 * Marketplace app (everyone else, lib/jobber-apps.ts) — each signing with its own
 * secret, so a body is genuine if ANY configured app's secret produces the header.
 */
function verifyJobberSignature(rawBody: string, signature: string): boolean {
  if (!signature) return false
  const b = Buffer.from(signature)
  return configuredJobberApps().some(({ clientSecret }) => {
    const expected = crypto.createHmac('sha256', clientSecret).update(rawBody, 'utf8').digest('base64')
    const a = Buffer.from(expected)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  })
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

  // Route the event to the right tenant by its Jobber accountId. An account no
  // company is mapped to is acked and DROPPED — it is some other Jobber account,
  // never Heroes' data (Heroes' account_id is mapped; its last unmapped events
  // predate that backfill). Only an event with NO accountId at all keeps the Heroes
  // default: every tenant's events carry one, so that path can't misroute anyone.
  let companyId = HEROES_FALLBACK_COMPANY_ID
  if (evt.accountId) {
    const mapped = await resolveCompanyByJobberAccountId(evt.accountId)
    if (!mapped) {
      console.warn('[jobber-webhook] no company mapped for accountId, dropping:', evt.accountId)
      return new NextResponse('ok', { status: 200 })
    }
    companyId = mapped
  } else {
    console.warn('[jobber-webhook] event has no accountId, falling back to Heroes default')
  }

  // `occuredAt` is the legacy spelling on apps created before 2023-12-08.
  const occurredAt = evt.occurredAt ?? evt.occuredAt ?? null

  // Record the event durably BEFORE acking. This is the whole point: a 200 tells
  // Jobber "we own this now" and it will never redeliver, so the ack must not be
  // sent until the event survives a crash. Processing then happens off the queue
  // with retry + dead-lettering (lib/jobber-webhook-queue.ts).
  //
  // Before this, processing ran post-ack via after() and a failure lost the event
  // permanently — 242 were dropped on prod that way. (Consts because the guard
  // above doesn't narrow evt's properties inside the closure.)
  const topic = evt.topic
  const itemId = evt.itemId

  const queued = await enqueueJobberWebhookEvent({ topic, itemId, companyId, occurredAt })
  if (!queued) {
    // Nothing durable was written, so do NOT ack — a 500 makes Jobber retry,
    // which is exactly the behavior we want when our own storage is unavailable.
    return new NextResponse('queue unavailable', { status: 500 })
  }

  // Drain immediately after the ack so the mirror still updates within seconds.
  // Unlike before, this is an optimization rather than the delivery mechanism:
  // if it never runs, the cron picks the event up.
  after(() =>
    drainJobberWebhookQueue().catch(err =>
      console.error('[jobber-webhook] post-ack drain failed:', err)
    )
  )

  return new NextResponse('ok', { status: 200 })
}

// Lightweight liveness check (Jobber never GETs this; handy for deploy verification).
export async function GET() {
  return NextResponse.json({ ok: true, configured: configuredJobberApps().length > 0, apps: configuredJobberApps().map(a => a.key) })
}
