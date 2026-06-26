import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  BusinessHoursSchedule,
  DEFAULT_RECORDING_CONSENT_NOTICE,
  EMPTY_VOICE_TWIML,
  HolidayEntry,
  injectConsentNotice,
  IvrConfig,
  IvrTreeName,
  pickIvrTree,
  startCallRecording,
  twimlRecordVoicemail,
  twimlRenderIvrNode,
  validateTwilioVoiceSignature,
  voiceConfigured,
} from '@/lib/twilio-voice'
import { buildIvrContext } from '@/lib/dialer-ivr-context'
import { conferenceRoomName } from '@/lib/twilio-conference'
import { connectInboundToAgentViaConference, isAgentDndNow } from '@/lib/dialer-conference-connect'
import { findOrCreateTxtContact } from '@/lib/dialer-lookup'
import type { ResponderMode } from '@/lib/responder'

const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

function twimlResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

// Twilio webhook target for inbound voice — configured on the Twilio
// phone number's Voice webhook. When PSTN dials our Twilio number, Twilio
// POSTs here.
//
// v1 routing (per Ben): try to route to a single configured user
// (dialer_settings.inbound_route_user_id) for ring_timeout_sec seconds. If
// unanswered OR no user configured, fall through to general voicemail. IVR +
// ring groups + per-user boxes land in Sessions 59–60.
//
// <Dial action="..."> is hit by Twilio when the dial finishes — with
// DialCallStatus indicating answered/no-answer/busy/failed/etc. The
// /voice/twiml/voicemail render endpoint reads that status and either ends
// the call cleanly (answered) or records a voicemail (everything else).
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  const signature = request.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/twiml/inbound`
  if (voiceConfigured()) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  const fromNumber = params.get('From') || ''
  const toNumber = params.get('To') || ''
  const callSid = params.get('CallSid') || ''

  // Log the inbound call up front. Status updates land later via /voice/status
  // (Twilio's separate Status Callback on the parent call) and the voicemail
  // render route (Dial action).
  //
  // Stamp handled_by = inbound_route_user_id so the routed user sees the call
  // in their Recent (scope=mine) tab — otherwise inbound rows have no owner
  // and only surface in All / Missed. When ring groups / IVR route to multiple
  // users in later sessions, this will need to widen to a per-leg attribution.
  const admin = createAdminClient()
  const [{ data: settings }, { data: responder }] = await Promise.all([
    admin
      .from('dialer_settings')
      .select('inbound_route_user_id, ring_timeout_sec, ivr_enabled, ivr_config, default_caller_id_number, business_hours, holidays, recording_enabled, recording_consent_notice, recording_consent_enabled, recording_consent_url, fallback_voicemail_url, fallback_voicemail_tts')
      .eq('company_id', HEROES_COMPANY_ID)
      .single(),
    admin
      .from('responder_settings')
      .select('mode, forwarded_line_ring_sec')
      .eq('company_id', HEROES_COMPANY_ID)
      .maybeSingle(),
  ])

  const routeToUserId = settings?.inbound_route_user_id
  const ringTimeout = settings?.ring_timeout_sec ?? 20
  const recordingEnabled = settings?.recording_enabled === true
  const consentEnabled = settings?.recording_consent_enabled !== false
  const consentNotice = settings?.recording_consent_notice || DEFAULT_RECORDING_CONSENT_NOTICE
  const consentUrl = settings?.recording_consent_url || null
  const responderMode = (responder?.mode as ResponderMode | undefined) ?? 'off'
  const forwardedLineRingSec = (responder?.forwarded_line_ring_sec as number | undefined) ?? 0

  // Phase 3: each inbound call gets a conference room so it can be held /
  // transferred once an agent answers. We stamp it on the calls row up front for
  // the single-user route; the IVR connect path generates + stamps its own room
  // at the moment it rings an agent.
  const room = conferenceRoomName()

  let contactId: string | null = null

  try {
    // Find-or-create the contact (the Unified Inbox spine), normalizing to E.164
    // — mirrors the inbound-SMS path. Previously this only *looked up* an exact
    // phone match, so first-time callers (and any non-normalized number) left
    // contact_id NULL, which dropped the call from the contact's timeline and
    // per-contact call history.
    if (fromNumber) {
      contactId = await findOrCreateTxtContact(HEROES_COMPANY_ID, fromNumber)
    }

    await admin.from('calls').insert({
      company_id: HEROES_COMPANY_ID,
      twilio_call_sid: callSid || null,
      direction: 'inbound',
      from_number: fromNumber || 'unknown',
      to_number: toNumber || 'unknown',
      status: 'ringing',
      contact_id: contactId,
      handled_by: routeToUserId || null,
      conference_name: room,
      // Stamp the active responder mode so the reconciler (which fires the
      // auto-text after the call ends) knows this call is responder-eligible
      // and which mode it ran under. Null when the responder is off.
      responder_mode: responderMode !== 'off' ? responderMode : null,
    })
  } catch {
    // swallow — call still proceeds
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const voicemailRender = `${baseUrl}/api/dialer/voice/twiml/voicemail`

  // Call recording (opt-in via dialer_settings.recording_enabled).
  // Two complementary approaches so EVERY answered call gets captured:
  //
  // (A) TwiML <Dial record> injection — inject dual-channel recording attrs
  //     into every <Dial> verb this webhook returns. This is the reliable path:
  //     it fires exactly when the rep answers, Twilio owns the recording lifecycle,
  //     and the recording webhook fires when the call ends. Works for IVR-routed
  //     calls (transfer_user, extension, ring_group) because those all generate
  //     <Dial> verbs that this injection catches.
  //
  // (B) REST startCallRecording — as a secondary attempt to record the full call
  //     including IVR audio before the rep answers. Fails with 21220 if the call
  //     isn't yet in a bridged state (common for IVR flows). We retry a few times
  //     but (A) is the guaranteed path.
  const recordingCallback = `${baseUrl}/api/dialer/voice/recording`

  if (recordingEnabled && callSid) {
    startCallRecording(callSid, recordingCallback).catch(() => {})
  }

  // (A) inject record attrs into every <Dial> in the returned TwiML.
  const injectRecordingIntoDials = (twiml: string): string => {
    if (!recordingEnabled) return twiml
    return twiml.replace(
      /<Dial(\s)/g,
      `<Dial record="record-from-answer-dual" recordingStatusCallback="${recordingCallback}" recordingStatusCallbackMethod="POST"$1`
    )
  }

  const respond = (body: string) => {
    let twiml = recordingEnabled ? injectConsentNotice(body, consentNotice, { url: consentUrl, enabled: consentEnabled }) : body
    twiml = injectRecordingIntoDials(twiml)
    return twimlResponse(twiml)
  }

  // Responder — Forwarded Line mode: the inbound call has already been
  // forwarded here (local Unitel number → 888) after we didn't answer, so the
  // 888 must NOT ring anyone. Skip IVR/routing and go straight to voicemail
  // using the SAME greeting configured in the regular Dialer settings. The
  // auto-text is fired later by the reconciler (/api/dialer/responder/reconcile)
  // once the call ends, so we can pick the right template based on whether the
  // caller actually left a message.
  //
  // Main Line mode (post-port, Twilio owns the local number) is NOT handled
  // here — it falls through to normal IVR/agent routing so the call can be
  // answered. The reconciler still texts the caller, but only if the call lands
  // in voicemail (an answered call never reaches the voicemail flow → no text).
  if (responderMode === 'forwarded_line') {
    // If "ring before voicemail" is configured AND a route user exists, let the
    // call ring for the configured seconds first. This creates a missed-call
    // entry in the Dialer (triggering the orange dot + notification) even when
    // the caller hangs up without leaving a voicemail. The agent-status callback
    // handles no-answer → voicemail automatically via the conference path.
    // If the call IS answered, answered_at gets stamped and the reconciler skips
    // the auto-text (a human picked up — no need to text back).
    if (forwardedLineRingSec > 0 && routeToUserId && !(await isAgentDndNow(admin, routeToUserId))) {
      const callerTwiml = await connectInboundToAgentViaConference({
        baseUrl,
        room,
        callerCallSid: callSid,
        callerNumber: fromNumber || undefined,
        agentIdentity: routeToUserId,
        // No voicemailOwnerUserId — use the general company voicemail box
        ringTimeoutSec: forwardedLineRingSec,
        recordingEnabled,
        recordingConsentNotice: consentNotice,
        recordingConsentEnabled: consentEnabled,
        recordingConsentUrl: consentUrl,
      })
      return twimlResponse(callerTwiml)
    }
    // ring=0 (or no route user) → original behavior: straight to voicemail.
    return respond(
      twimlRecordVoicemail({
        action: `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/voicemail/complete`,
        greetingUrl: settings?.fallback_voicemail_url || null,
        greetingTts: settings?.fallback_voicemail_tts || null,
        spokenFallback:
          "Thanks for calling. Please leave a message after the beep and we'll get back to you. Press pound when finished.",
      })
    )
  }

  // IVR takes precedence when enabled and the picked tree has a root node.
  // Session 61 picks default/after_hours/holiday based on business_hours +
  // holidays config. If the picked tree is misconfigured, fall back to default.
  if (settings?.ivr_enabled && settings.ivr_config) {
    const config = settings.ivr_config as IvrConfig
    const businessHours = (settings.business_hours as BusinessHoursSchedule | null) || null
    const holidays = (settings.holidays as HolidayEntry[] | null) || null
    let treeName: IvrTreeName = pickIvrTree({ config, businessHours, holidays })
    let tree = config.trees?.[treeName]
    // Fallback if picked tree is missing or has no root (shouldn't normally happen
    // — pickIvrTree only returns non-default when those trees have root_node_id —
    // but defensive against jsonb shape drift).
    if (!tree?.root_node_id || !tree.nodes?.[tree.root_node_id]) {
      treeName = 'default'
      tree = config.trees?.default
    }
    if (tree?.root_node_id && tree.nodes?.[tree.root_node_id]) {
      const ctx = await buildIvrContext(admin, HEROES_COMPANY_ID)
      const gatherActionUrlFor = (t: IvrTreeName, n: string, r: number) =>
        `${baseUrl}/api/dialer/voice/twiml/ivr?tree=${encodeURIComponent(t)}&node=${encodeURIComponent(n)}&r=${r}`
      return respond(
        twimlRenderIvrNode({
          config,
          treeName,
          nodeId: tree.root_node_id,
          baseUrl,
          gatherActionUrlFor,
          voicemailRouteUrl: voicemailRender,
          callerId: fromNumber || undefined,
          extensionResolver: ctx.extensionResolver,
          ringGroupUrlFor: ctx.ringGroupUrlFor,
          perUserVoicemailUrlFor: ctx.perUserVoicemailUrlFor,
        })
      )
    }
    // IVR enabled but misconfigured (no default tree) — fall through to the
    // legacy ring-Ben-then-voicemail path so calls don't die in dead air.
  }

  if (routeToUserId && !(await isAgentDndNow(admin, routeToUserId))) {
    // Phase 3: bridge the caller through a conference and ring the configured
    // user as the 'agent' participant. No-answer falls to voicemail via the
    // agent participant's status callback. (Recording + consent handled inside.)
    const callerTwiml = await connectInboundToAgentViaConference({
      baseUrl,
      room,
      callerCallSid: callSid,
      callerNumber: fromNumber || undefined,
      agentIdentity: routeToUserId,
      // No voicemailOwnerUserId: an unanswered business call lands in the COMPANY
      // voicemail box, not the routed person's personal greeting. Personal
      // greetings are reserved for direct extension dials. (Ben, June 26 2026.)
      ringTimeoutSec: ringTimeout,
      recordingEnabled,
      recordingConsentNotice: consentNotice,
      recordingConsentEnabled: consentEnabled,
      recordingConsentUrl: consentUrl,
    })
    return twimlResponse(callerTwiml)
  }

  // No route configured — go straight to general voicemail. Settings already
  // fetched above, so we can use `settings` directly.
  return respond(
    twimlRecordVoicemail({
      action: `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/voicemail/complete`,
      greetingUrl: settings?.fallback_voicemail_url || null,
      greetingTts: settings?.fallback_voicemail_tts || null,
      spokenFallback:
        "Thanks for calling. Please leave a message after the beep and we'll get back to you. Press pound when finished.",
    })
  )
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    twilio_configured: voiceConfigured(),
    route: 'dialer.voice.twiml.inbound',
  })
}
