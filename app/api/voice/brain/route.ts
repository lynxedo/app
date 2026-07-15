import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildGuardianSystem } from '@/lib/guardian-persona'
import { getGuardianModel } from '@/lib/guardian-knowledge'
import { CLAUDE_MODEL } from '@/lib/anthropic'
import { getEffectiveVoiceReceptionistSettings } from '@/lib/voice-receptionist-settings'
import { getSchedulingEnabled } from '@/lib/voice-scheduling'
import {
  buildCallContextNote,
  buildRoutingDirectoryNote,
  buildTransferInstruction,
  buildWelcomeGreeting,
  CUSTOMER_SERVICE_INSTRUCTION,
  FRONTLINE_INSTRUCTION,
  SCHEDULING_INSTRUCTION,
  VOICEMAIL_ESCAPE_INSTRUCTION,
  type ReceptionistLevel,
} from '@/lib/voice-receptionist'
import { getRoutingDirectory } from '@/lib/voice-routing'
import { startCallRecording, isWithinBusinessHours, BusinessHoursSchedule } from '@/lib/twilio-voice'
import { findOrCreateTxtContact, lookupByPhone } from '@/lib/dialer-lookup'
import { filterNonDndUserIds } from '@/lib/dialer-conference-connect'
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

      // Reconcile with any row the inbound webhook already created for this call.
      // The 832 dialer path (app/api/dialer/voice/twiml/inbound) inserts a
      // 'ringing' row BEFORE the call is handed to the receptionist (missed /
      // after-hours / weekend → the voicemail route → Amber), whereas direct
      // entry points (app/api/voice/twiml, the 888 line) insert nothing.
      // Update-in-place when a row already exists, else insert — so a 832
      // receptionist call is logged exactly once (no duplicate Call Log entry).
      // On UPDATE we deliberately do NOT overwrite from_number/to_number: the
      // inbound row already holds the real values, whereas brain's body copy can
      // be 'unknown' if the relay omitted them.
      const nowIso = new Date().toISOString()
      const { data: existingCall } = await admin
        .from('calls')
        .select('id')
        .eq('twilio_call_sid', callSid)
        .limit(1)
      if (existingCall && existingCall.length > 0) {
        await admin
          .from('calls')
          .update({
            status: 'in-progress',
            answered_at: nowIso,
            call_type: 'ai_receptionist',
            ...(contactId ? { contact_id: contactId } : {}),
          })
          .eq('twilio_call_sid', callSid)
      } else {
        await admin.from('calls').insert({
          company_id: companyId,
          twilio_call_sid: callSid,
          direction: 'inbound',
          from_number: fromNumber,
          to_number: toNumber,
          status: 'in-progress',
          answered_at: nowIso,
          contact_id: contactId,
          handled_by: null,
          call_type: 'ai_receptionist',
        })
      }

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
  // is configured, reachable recipients exist, it's currently business hours,
  // AND at least one recipient is not on Do Not Disturb. For the cell method
  // "reachable" also means the recipient has a number on file — otherwise
  // there's no one to ring. When everyone is DND, Amber gets the "no transfer"
  // instruction and takes a message instead of promising a hand-off.
  const candidateRecipientIds =
    settings.transferMethod === 'cell'
      ? settings.transferUserIds.filter((id) => Boolean(settings.transferCellNumbers[id]))
      : settings.transferUserIds
  let transferAvailable = false
  if (settings.transferMethod !== 'off' && candidateRecipientIds.length > 0) {
    try {
      const { data: ds } = await admin
        .from('dialer_settings')
        .select('business_hours')
        .eq('company_id', companyId)
        .maybeSingle()
      transferAvailable = isWithinBusinessHours((ds?.business_hours as BusinessHoursSchedule | null) ?? null)
      if (transferAvailable) {
        const notDnd = await filterNonDndUserIds(admin, candidateRecipientIds)
        transferAvailable = notDnd.length > 0
      }
    } catch {
      transferAvailable = false
    }
  }

  // Assemble the shared Guardian system prompt in 'voice' mode + the phone task
  // (the editable instructions, or the default) plus the always-on escape hatch,
  // the per-call transfer instruction, and this call's context note.
  // Level-4 scheduling: only offer booking (and the booking tools) when the
  // company is at Level 4 AND scheduling is enabled. Below that, canSchedule is
  // false → no scheduling instruction, and the voice service withholds the
  // find_availability / book_appointment tools.
  // Effective level. A TEST-LINE OVERRIDE lets Level 5 (frontline) be exercised
  // on the test number (env VOICE_TEST_NUMBER) at env VOICE_TEST_LEVEL WITHOUT
  // changing the company's stored level — so the live main line is never touched
  // by testing. When the override isn't set / doesn't match, the stored company
  // level drives every call as usual.
  let effLevel: ReceptionistLevel = settings.level
  const testNumber = (process.env.VOICE_TEST_NUMBER || '').trim()
  const testLevel = Math.round(Number(process.env.VOICE_TEST_LEVEL))
  const isTestLine = Boolean(testNumber && body.to === testNumber && testLevel >= 1 && testLevel <= 5)
  if (isTestLine) {
    effLevel = testLevel as ReceptionistLevel
  }

  // Level-4 scheduling AND Level-5 frontline both layer on top of the Level-3
  // base. canSchedule = Level 4 or 5 + scheduling enabled.
  const schedulingEnabled = await getSchedulingEnabled(admin, companyId)
  const canSchedule = (effLevel === 4 || effLevel === 5) && schedulingEnabled

  // frontlineActive = Level 5 AND the call is on a frontline-eligible line:
  // the test line (via the override above) OR any line once AI_FRONTLINE_ENABLED
  // is set. This is the deliberate on-switch for the front desk — so merely
  // SELECTING Level 5 in Admin can't turn the live main line into a frontline
  // receptionist before it's explicitly enabled + tested. When Level 5 is chosen
  // but not yet frontline-eligible, the call behaves as Level 4 (scheduling +
  // base) with no routing layer.
  const frontlineEligible = isTestLine || process.env.AI_FRONTLINE_ENABLED === 'true'
  const frontlineActive = effLevel === 5 && frontlineEligible

  // Frontline: inject the routing directory so Amber knows who she can send
  // callers to. Drop 'user' (softphone) destinations whose owner is on Do Not
  // Disturb right now, so she never offers a transfer to someone unavailable
  // (ring groups do their own DND filtering downstream).
  let routingNote = ''
  if (frontlineActive) {
    try {
      const dir = (await getRoutingDirectory(admin, companyId)).filter((e) => e.enabled)
      const userDestIds = dir.filter((e) => e.dest_kind === 'user').map((e) => e.dest_value).filter(Boolean)
      const notDnd = userDestIds.length ? await filterNonDndUserIds(admin, userDestIds) : []
      const reachable = dir.filter((e) => e.dest_kind !== 'user' || notDnd.includes(e.dest_value))
      routingNote = buildRoutingDirectoryNote(
        reachable.map((e) => ({ label: e.label, kind: e.kind, description: e.description })),
      )
    } catch (err) {
      console.warn('[voice.brain] routing directory load failed', (err as Error).message)
      routingNote = buildRoutingDirectoryNote([])
    }
  }

  const task = [
    settings.instructions,
    VOICEMAIL_ESCAPE_INSTRUCTION,
    CUSTOMER_SERVICE_INSTRUCTION,
    canSchedule ? SCHEDULING_INSTRUCTION : null,
    // Level 5 replaces the flat transfer instruction with the frontline routing
    // layer (route_call → the routing directory). Below Level 5, the usual
    // single-transfer instruction applies.
    frontlineActive ? FRONTLINE_INSTRUCTION : null,
    frontlineActive ? routingNote : buildTransferInstruction(transferAvailable),
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

  // At Level 5 the greeting must read as the front desk (never "the team isn't
  // available"), so use the frontline default rather than the business/after-hours
  // greeting. Below Level 5 the configured greeting stands.
  const greeting = frontlineActive
    ? buildWelcomeGreeting(5, { name: settings.receptionistName })
    : settings.greeting

  return NextResponse.json({
    companyId,
    model,
    system,
    greeting,
    callSid: body.callSid ?? null,
    // meta.canSchedule → offer the find_availability / book_appointment tools.
    // meta.canRoute → offer the route_call tool (Level 5 frontline routing).
    meta: { canSchedule, canRoute: frontlineActive },
  })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: Boolean(process.env.VOICE_SERVICE_SECRET),
    route: 'voice.brain',
  })
}
