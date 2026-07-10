import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildGuardianSystem } from '@/lib/guardian-persona'
import { getGuardianModel } from '@/lib/guardian-knowledge'
import { CLAUDE_MODEL } from '@/lib/anthropic'
import { getEffectiveVoiceReceptionistSettings } from '@/lib/voice-receptionist-settings'

// AI Voice Receptionist — "brain" endpoint (Phase 1a).
//
// The standalone ConversationRelay WS service (repo: ~/lynxedo-voice) is pure
// transport. When a call connects it POSTs here to fetch everything it needs to
// drive the model on OUR shared Guardian brain: the assembled system prompt, the
// configured model, and the greeting. All company/knowledge logic stays here so
// the WS service never touches the DB or the Anthropic account directly.
//
// Auth: shared secret in the Authorization: Bearer header (env
// VOICE_SERVICE_SECRET), matched constant-time.

export const runtime = 'nodejs'

// Phase 1a is single-tenant (Heroes). Reuses the same company-id constant the
// dialer routes use.
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

  // Body is informational for now (call context). Parsed defensively.
  let body: { to?: string; from?: string; callSid?: string } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    // no/invalid body — fine, Phase 1a resolves a fixed tenant anyway
  }

  const companyId = HEROES_COMPANY_ID
  const admin = createAdminClient()

  // Load the company's editable receptionist settings (Admin -> Dialer -> AI
  // Receptionist), falling back to the code defaults when a field is blank.
  const settings = await getEffectiveVoiceReceptionistSettings(admin, companyId)

  // Assemble the shared Guardian system prompt in 'voice' mode + the phone task
  // (the editable instructions, or the VOICE_RECEPTIONIST_PROMPT default).
  const system = await buildGuardianSystem({
    companyId,
    knowledge: 'voice',
    task: settings.instructions,
    admin,
  })

  // DB-configured Guardian model, falling back to the platform default.
  let model = CLAUDE_MODEL
  try {
    model = await getGuardianModel(admin, companyId)
  } catch {
    // non-fatal — use CLAUDE_MODEL
  }

  return NextResponse.json({
    companyId,
    model,
    system,
    greeting: settings.greeting,
    callSid: body.callSid ?? null,
  })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: Boolean(process.env.VOICE_SERVICE_SECRET),
    route: 'voice.brain',
  })
}
