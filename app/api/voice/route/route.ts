import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRoutingDirectory, matchRoutingEntry } from '@/lib/voice-routing'

// AI Voice Receptionist — Level 5 frontline routing tool endpoint.
//
// The voice service calls this mid-call when the assistant uses her `route_call`
// tool: she passes the person/department the caller wants; we match it to the
// company's routing directory and RECORD the chosen destination against the call
// (voice_transfer_attempts). She then ends her message with [[TRANSFER]] and the
// ConversationRelay <Connect action> fallback route reads this record and dials
// that specific destination. Returns a short `answer` for the assistant to speak.
//
// Auth: Bearer VOICE_SERVICE_SECRET (same as the other /api/voice/* tools).

export const runtime = 'nodejs'

// TODO: phone -> company map for multi-tenant (resolve companyId from `to`).
const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

function bearerAuthorized(request: Request): boolean {
  const secret = process.env.VOICE_SERVICE_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return false
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  if (!bearerAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { to?: string; from?: string; callSid?: string; entry?: string } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    // fall through — no entry → graceful "couldn't route" answer
  }

  const companyId = HEROES_COMPANY_ID
  const admin = createAdminClient()

  const query = (body.entry || '').trim()
  const dir = await getRoutingDirectory(admin, companyId)
  const match = matchRoutingEntry(dir, query)

  // No match → tell the assistant to take a message instead (she will NOT emit
  // the transfer marker).
  if (!match) {
    return NextResponse.json({
      matched: false,
      answer:
        "I couldn't find the right person to connect them to. Let the caller know you'll take a message and the right team member will follow up — do not transfer.",
    })
  }

  // Record the chosen destination against this call so the fallback route can
  // dial it on [[TRANSFER]]. Keyed by the caller's call sid.
  const callSid = (body.callSid || '').trim()
  if (callSid) {
    try {
      await admin.from('voice_transfer_attempts').insert({
        company_id: companyId,
        queue_name: `route_${callSid}`,
        caller_call_sid: callSid,
        caller_from: body.from || null,
        status: 'pending',
        route_dest_kind: match.dest_kind,
        route_dest_value: match.dest_value,
        route_label: match.label,
        expires_at: new Date(Date.now() + 120_000).toISOString(),
      })
    } catch (err) {
      console.error('[voice.route] record route target failed', err)
      // Non-fatal: still let her attempt the transfer; the fallback will fall
      // back to the flat transfer method if it finds no recorded target.
    }
  }

  return NextResponse.json({
    matched: true,
    label: match.label,
    answer: `Great — let the caller know you're connecting them to ${match.label} now, then hand off.`,
  })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: Boolean(process.env.VOICE_SERVICE_SECRET),
    route: 'voice.route',
  })
}
