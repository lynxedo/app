import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  EMPTY_VOICE_TWIML,
  IvrAction,
  IvrConfig,
  IvrTreeName,
  twimlRenderIvrAction,
  twimlRenderIvrNode,
  twimlRenderIvrRepeat,
  validateTwilioVoiceSignature,
  voiceConfigured,
} from '@/lib/twilio-voice'

const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

function twimlResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

// Hit by Twilio when a caller presses a digit on an IVR <Gather>. The Gather's
// action URL is built by gatherActionUrlFor() in the inbound route — it includes
// the current tree name, node id, and repeat counter in the query string.
//
// Twilio POSTs the keypress in the `Digits` form field. We look up the matching
// node + keypress action and render the next TwiML.
//
// Empty Digits means no-input (Gather timeout): we apply the node's no_input
// fallback. Digits with no mapped action means invalid input: we apply
// invalid_input fallback.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  const url = new URL(request.url)
  const treeName = (url.searchParams.get('tree') || 'default') as IvrTreeName
  const nodeId = url.searchParams.get('node') || ''
  const repeatCount = parseInt(url.searchParams.get('r') || '0', 10) || 0

  const signature = request.headers.get('x-twilio-signature')
  const validateUrl = `${process.env.NEXT_PUBLIC_APP_URL}${url.pathname}${url.search}`
  if (voiceConfigured() && signature) {
    if (!validateTwilioVoiceSignature(validateUrl, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  const digits = (params.get('Digits') || '').trim()
  const fromNumber = params.get('From') || undefined

  const admin = createAdminClient()
  const { data: settings } = await admin
    .from('dialer_settings')
    .select('ivr_config, ivr_enabled, default_caller_id_number')
    .eq('company_id', HEROES_COMPANY_ID)
    .single()

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const voicemailRouteUrl = `${baseUrl}/api/dialer/voice/twiml/voicemail`
  const gatherActionUrlFor = (t: IvrTreeName, n: string, r: number) =>
    `${baseUrl}/api/dialer/voice/twiml/ivr?tree=${encodeURIComponent(t)}&node=${encodeURIComponent(n)}&r=${r}`

  if (!settings?.ivr_enabled || !settings.ivr_config) {
    // IVR turned off mid-call — bail to voicemail rather than loop.
    return twimlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${voicemailRouteUrl}</Redirect></Response>`
    )
  }

  const config = settings.ivr_config as IvrConfig
  const tree = config.trees?.[treeName]
  const node = tree?.nodes?.[nodeId]

  if (!tree || !node) {
    return twimlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${voicemailRouteUrl}</Redirect></Response>`
    )
  }

  // Resolve which action fires.
  let action: IvrAction | undefined
  if (!digits) {
    // No-input timeout. Default to repeat-then-voicemail if not configured.
    action = node.no_input ?? { kind: 'repeat', max_repeats: 2, then: { kind: 'voicemail' } }
  } else {
    const key = digits as keyof typeof node.keypresses
    action = node.keypresses?.[key]
    if (!action) {
      action = node.invalid_input ?? { kind: 'repeat', max_repeats: 2, then: { kind: 'voicemail' } }
    }
  }

  // Handle the 'repeat' meta-action by re-rendering the current node with an
  // incremented counter. After max_repeats hits, fall through to .then.
  if (action.kind === 'repeat') {
    return twimlResponse(
      twimlRenderIvrRepeat({
        config,
        treeName,
        nodeId,
        baseUrl,
        gatherActionUrlFor,
        voicemailRouteUrl,
        callerId: fromNumber,
        repeatCount,
        maxRepeats: action.max_repeats ?? 2,
        fallback: action.then,
      })
    )
  }

  // Submenu → render the target node with a fresh Gather.
  if (action.kind === 'submenu') {
    return twimlResponse(
      twimlRenderIvrNode({
        config,
        treeName,
        nodeId: action.target_node_id,
        baseUrl,
        gatherActionUrlFor,
        voicemailRouteUrl,
        callerId: fromNumber,
        repeatCount: 0,
      })
    )
  }

  // Terminal action (voicemail / transfer_* / say / hangup / extension / ring_group).
  return twimlResponse(
    twimlRenderIvrAction({
      action,
      config,
      treeName,
      baseUrl,
      gatherActionUrlFor,
      voicemailRouteUrl,
      callerId: fromNumber,
    })
  )
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    twilio_configured: voiceConfigured(),
    route: 'dialer.voice.twiml.ivr',
  })
}
