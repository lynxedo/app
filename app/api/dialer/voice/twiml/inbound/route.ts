import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  BusinessHoursSchedule,
  EMPTY_VOICE_TWIML,
  HolidayEntry,
  IvrConfig,
  IvrTreeName,
  pickIvrTree,
  twimlDialClient,
  twimlRecordVoicemail,
  twimlRenderIvrNode,
  validateTwilioVoiceSignature,
  voiceConfigured,
} from '@/lib/twilio-voice'
import { buildIvrContext } from '@/lib/dialer-ivr-context'

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
  if (voiceConfigured() && signature) {
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
  const admin = createAdminClient()
  try {
    let contactId: string | null = null
    if (fromNumber) {
      const { data: contact } = await admin
        .from('txt_contacts')
        .select('id')
        .eq('company_id', HEROES_COMPANY_ID)
        .eq('phone', fromNumber)
        .maybeSingle()
      contactId = contact?.id ?? null
    }

    await admin.from('calls').insert({
      company_id: HEROES_COMPANY_ID,
      twilio_call_sid: callSid || null,
      direction: 'inbound',
      from_number: fromNumber || 'unknown',
      to_number: toNumber || 'unknown',
      status: 'ringing',
      contact_id: contactId,
    })
  } catch {
    // swallow — call still proceeds
  }

  const { data: settings } = await admin
    .from('dialer_settings')
    .select('inbound_route_user_id, ring_timeout_sec, ivr_enabled, ivr_config, default_caller_id_number, business_hours, holidays')
    .eq('company_id', HEROES_COMPANY_ID)
    .single()

  const routeToUserId = settings?.inbound_route_user_id
  const ringTimeout = settings?.ring_timeout_sec ?? 20

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const voicemailRender = `${baseUrl}/api/dialer/voice/twiml/voicemail`

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
      return twimlResponse(
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

  if (routeToUserId) {
    return twimlResponse(
      twimlDialClient({
        identity: routeToUserId,
        callerId: fromNumber || undefined,
        timeoutSeconds: ringTimeout,
        statusCallback: voicemailRender,
      })
    )
  }

  // No route configured — go straight to general voicemail. We need to fetch
  // the greeting URL here since this branch skips the Dial-then-render path.
  const { data: vmSettings } = await admin
    .from('dialer_settings')
    .select('fallback_voicemail_url')
    .eq('company_id', HEROES_COMPANY_ID)
    .single()

  return twimlResponse(
    twimlRecordVoicemail({
      action: `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/voicemail/complete`,
      greetingUrl: vmSettings?.fallback_voicemail_url || null,
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
