import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildGuardianSystem } from '@/lib/guardian-persona'
import { getGuardianModel } from '@/lib/guardian-knowledge'
import { CLAUDE_MODEL } from '@/lib/anthropic'
import { getEffectiveVoiceReceptionistSettings } from '@/lib/voice-receptionist-settings'
import {
  buildCallContextNote,
  buildTransferInstruction,
  CUSTOMER_SERVICE_INSTRUCTION,
  VOICEMAIL_ESCAPE_INSTRUCTION,
} from '@/lib/voice-receptionist'
import { startCallRecording, isWithinBusinessHours, BusinessHoursSchedule } from '@/lib/twilio-voice'
import { findOrCreateTxtContact, lookupByPhone } from '@/lib/dialer-lookup'
import { formatPhone } from '@/lib/format'

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

  // Log the call + start recording.
  //
  // WHY THIS IS HERE, NOT IN THE TwiML:
  // 1. `<Start><Recording>` in the ConversationRelay TwiML does NOT produce a
  //    recording — verified live (Twilio's own Recordings API returns zero
  //    resources for calls that included it, with no error). The proven,
  //    working mechanism elsewhere in this codebase is the REST API
  //    (startCallRecording, used by the real inbound/outbound dialer routes),
  //    fired once the call is actually connected — which is exactly now.
  // 2. Direct entry points (app/api/voice/twiml) never insert a `calls` row at
  //    all, so calls never appeared in the Call Log and the recording
  //    completion webhook (app/api/dialer/voice/recording) had nothing to
  //    attach to even when a recording did exist. This endpoint is the one
  //    place EVERY receptionist call passes through exactly once at connect
  //    time, so it's the right place to log the call for every entry point.
  // Awaited directly (NOT after()) — after() proved unreliable for this route
  // (called by an external Node service, not a browser navigation); verified
  // live that its body never ran. The greeting is static TwiML spoken
  // immediately, and the caller's first reply is several seconds out, so this
  // adds no perceptible latency.
  if (body.callSid) {
    const callSid = body.callSid
    const toNumber = body.to || 'unknown'
    const fromNumber = body.from || 'unknown'
    try {
      const { data: dialerSettings } = await admin
        .from('dialer_settings')
        .select('recording_enabled')
        .eq('company_id', companyId)
        .maybeSingle()
      const recordingEnabled = dialerSettings?.recording_enabled === true

      let contactId: string | null = null
      if (body.from) {
        contactId = await findOrCreateTxtContact(companyId, body.from).catch(() => null)
      }

      await admin.from('calls').insert({
        company_id: companyId,
        twilio_call_sid: callSid,
        direction: 'inbound',
        from_number: fromNumber,
        to_number: toNumber,
        status: 'in-progress',
        answered_at: new Date().toISOString(),
        contact_id: contactId,
        handled_by: null,
        call_type: 'ai_receptionist',
      })

      if (recordingEnabled) {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
        startCallRecording(callSid, `${baseUrl}/api/dialer/voice/recording`).catch((err) =>
          console.error('[voice.brain] startCallRecording failed', err)
        )
      }
    } catch (err) {
      console.error('[voice.brain] call logging failed', err)
    }
  }

  // Identify the caller (by the number they're calling from) so the assistant
  // can greet an existing contact by name and confirm the callback number
  // instead of asking for it. Local DB lookup only (no caller-ID/CNAM fetch) so
  // it stays fast at call-connect time. Company-scoped — never cross-tenant.
  let callerName: string | null = null
  let callerIsExisting = false
  if (body.from) {
    try {
      const match = await lookupByPhone(body.from, companyId)
      if (match?.name && !match.nameIsCallerId) {
        callerName = match.name
        callerIsExisting = true
      }
    } catch (err) {
      console.warn('[voice.brain] caller lookup failed', (err as Error).message)
    }
  }
  // NOTE: the caller's next visit / service is NOT fetched here. It's looked up
  // LIVE from Jobber, on demand, only if the caller asks — via the account-lookup
  // tool (POST /api/voice/lookup) the voice service exposes to the assistant. That
  // keeps call setup fast (no Jobber round-trip before the greeting) and the data
  // fresh; see Reference/PRDs/AI_RECEPTIONIST_PRD.md §18.
  const callContext = buildCallContextNote({
    callerName,
    callerPhone: body.from ? formatPhone(body.from) || body.from : null,
    callerIsExisting,
  })

  // Transfer availability: a live-person transfer is only offered when a method
  // is configured, reachable recipients exist, AND it's currently business
  // hours. For the cell method "reachable" also means the recipient has a number
  // on file — otherwise there's no one to ring.
  const recipientsReady =
    settings.transferMethod === 'cell'
      ? settings.transferUserIds.some((id) => Boolean(settings.transferCellNumbers[id]))
      : settings.transferUserIds.length > 0
  let transferAvailable = false
  if (settings.transferMethod !== 'off' && recipientsReady) {
    try {
      const { data: ds } = await admin
        .from('dialer_settings')
        .select('business_hours')
        .eq('company_id', companyId)
        .maybeSingle()
      transferAvailable = isWithinBusinessHours((ds?.business_hours as BusinessHoursSchedule | null) ?? null)
    } catch {
      transferAvailable = false
    }
  }

  // Assemble the shared Guardian system prompt in 'voice' mode + the phone task
  // (the editable instructions, or the default) plus the always-on escape hatch,
  // the per-call transfer instruction, and this call's context note.
  const task = [
    settings.instructions,
    VOICEMAIL_ESCAPE_INSTRUCTION,
    CUSTOMER_SERVICE_INSTRUCTION,
    buildTransferInstruction(transferAvailable),
    callContext,
  ]
    .filter(Boolean)
    .join('\n\n')
  const system = await buildGuardianSystem({
    companyId,
    knowledge: 'voice',
    surface: 'receptionist',
    task,
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
