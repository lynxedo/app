import { NextRequest, NextResponse, after } from 'next/server'
import crypto from 'crypto'
import { processJobberWebhookEvent, resolveCompanyByJobberAccountId } from '@/lib/jobber-sync'

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

  // TEMP (Track 3 rollout): log the raw accountId so the orchestrator can capture
  // Heroes' real value for the migration backfill and confirm its format matches
  // what the OAuth `{ account { id } }` query stores. REMOVE once backfilled.
  console.log('[jobber-webhook] accountId=', evt.accountId)

  // Route the event to the right tenant by its Jobber accountId. If the account
  // is mapped, use its company; otherwise (unmapped account, or accountId absent)
  // fall back to the Heroes default and warn loudly. The fallback keeps Heroes
  // safe during the single-tenant phase and while account mapping is backfilled.
  // ⚠ Once all tenants are mapped, an unknown/absent accountId should be rejected
  // (ack-and-drop) instead of attributed to Heroes — see HEROES_FALLBACK_COMPANY_ID.
  let companyId = HEROES_FALLBACK_COMPANY_ID
  if (evt.accountId) {
    const mapped = await resolveCompanyByJobberAccountId(evt.accountId)
    if (mapped) {
      companyId = mapped
    } else {
      console.warn(
        '[jobber-webhook] no company mapped for accountId, falling back to Heroes default:',
        evt.accountId
      )
    }
  } else {
    console.warn('[jobber-webhook] event has no accountId, falling back to Heroes default')
  }

  // `occuredAt` is the legacy spelling on apps created before 2023-12-08.
  const occurredAt = evt.occurredAt ?? evt.occuredAt ?? null

  // Acknowledge fast (Jobber wants 200 within seconds); process post-response
  // via after() — a bare detached promise is NOT guaranteed to run once the
  // handler returns, which could silently drop the event. (Consts because the
  // guard above doesn't narrow evt's properties inside the closure.)
  const topic = evt.topic
  const itemId = evt.itemId
  after(() =>
    processJobberWebhookEvent({ topic, itemId, companyId, occurredAt })
      .catch(err => console.error('[jobber-webhook]', topic, itemId, err))
  )

  return new NextResponse('ok', { status: 200 })
}

// Lightweight liveness check (Jobber never GETs this; handy for deploy verification).
export async function GET() {
  return NextResponse.json({ ok: true, configured: Boolean(process.env.JOBBER_CLIENT_SECRET) })
}
