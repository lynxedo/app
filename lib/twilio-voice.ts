// Twilio Voice helpers — server-side. Mirrors lib/twilio.ts (which handles SMS)
// but for the Voice JS SDK + voice TwiML + recording downloads.
//
// All env-empty paths return safe defaults so this module can be imported and
// referenced on staging without configured creds. Returns 'twilio_not_configured'
// errors that surface in the UI rather than throwing.
//
// Required env vars when going live:
//   TWILIO_ACCOUNT_SID         — already set for SMS (same value)
//   TWILIO_AUTH_TOKEN          — already set for SMS (same value, used for webhook signature validation + media downloads)
//   TWILIO_API_KEY_SID         — NEW: Twilio API Key SID (starts with SK...) — mint at console.twilio.com → Account → API keys
//   TWILIO_API_KEY_SECRET      — NEW: Twilio API Key Secret (one-time-visible at creation)
//   TWILIO_TWIML_APP_SID       — NEW: Voice TwiML App SID (starts with AP...) — created in Twilio console, points to /api/dialer/voice/twiml/outbound

import crypto from 'node:crypto'
import { SignJWT } from 'jose'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const API_KEY_SID = process.env.TWILIO_API_KEY_SID || ''
const API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET || ''
const TWIML_APP_SID = process.env.TWILIO_TWIML_APP_SID || ''
const CALLER_ID = process.env.TWILIO_PHONE_NUMBER || ''

export function voiceConfigured(): boolean {
  return Boolean(ACCOUNT_SID && API_KEY_SID && API_KEY_SECRET && TWIML_APP_SID)
}

export function voiceCallerId(): string {
  return CALLER_ID
}

// ---------------------------------------------------------------------------
// Voice Access Token (JWT) — minted server-side, sent to the browser. The
// Twilio Voice JS SDK uses this to register with Twilio and place/receive
// calls. Tokens are short-lived (default 1 hour) and tied to a single
// identity (the user's hub_users.id).
//
// Twilio's JWT shape:
//   header: { alg: HS256, typ: JWT, cty: twilio-fpa;v=1 }
//   payload:
//     iss: API_KEY_SID
//     sub: ACCOUNT_SID
//     exp: now + ttl
//     iat: now
//     jti: ${API_KEY_SID}-${random}
//     grants:
//       identity: <userId>
//       voice:
//         incoming: { allow: true }
//         outgoing:
//           application_sid: TWIML_APP_SID
//           params: {}
//
// Signed HS256 with API_KEY_SECRET.
// Reference: https://www.twilio.com/docs/iam/access-tokens
// ---------------------------------------------------------------------------

export type VoiceAccessTokenResult =
  | { ok: true; token: string; identity: string; ttlSeconds: number; expiresAt: number }
  | { ok: false; error: string }

export async function mintVoiceAccessToken(opts: {
  identity: string
  ttlSeconds?: number
}): Promise<VoiceAccessTokenResult> {
  if (!voiceConfigured()) {
    return { ok: false, error: 'twilio_not_configured' }
  }
  if (!opts.identity) {
    return { ok: false, error: 'identity_required' }
  }

  const ttl = opts.ttlSeconds ?? 3600
  const now = Math.floor(Date.now() / 1000)
  const exp = now + ttl
  const jti = `${API_KEY_SID}-${crypto.randomBytes(8).toString('hex')}`

  const grants = {
    identity: opts.identity,
    voice: {
      incoming: { allow: true },
      outgoing: {
        application_sid: TWIML_APP_SID,
      },
    },
  }

  const secret = new TextEncoder().encode(API_KEY_SECRET)
  const token = await new SignJWT({ jti, grants })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' })
    .setIssuer(API_KEY_SID)
    .setSubject(ACCOUNT_SID)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secret)

  return { ok: true, token, identity: opts.identity, ttlSeconds: ttl, expiresAt: exp }
}

// ---------------------------------------------------------------------------
// TwiML builders. TwiML is Twilio's XML format that tells Twilio what to do
// during a call (dial a number, play audio, run a menu, etc.).
// ---------------------------------------------------------------------------

function escapeXmlAttr(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function escapeXmlText(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export const EMPTY_VOICE_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response/>'

// Outbound (browser → PSTN): Voice JS SDK calls this endpoint with the dialed
// number in form params. We respond with TwiML telling Twilio to dial that
// number, with the caller-ID set to our Twilio number.
export function twimlDialPstn(opts: {
  to: string
  callerId?: string
  recordCalls?: boolean
  recordingStatusCallback?: string
  statusCallback?: string
  timeoutSeconds?: number
}): string {
  const from = opts.callerId || CALLER_ID
  const attrs: string[] = []
  if (from) attrs.push(`callerId="${escapeXmlAttr(from)}"`)
  if (opts.timeoutSeconds) attrs.push(`timeout="${opts.timeoutSeconds}"`)
  if (opts.recordCalls) {
    attrs.push('record="record-from-answer"')
    if (opts.recordingStatusCallback) {
      attrs.push(
        `recordingStatusCallback="${escapeXmlAttr(opts.recordingStatusCallback)}"`
      )
      attrs.push('recordingStatusCallbackMethod="POST"')
    }
  }
  if (opts.statusCallback) {
    attrs.push(`action="${escapeXmlAttr(opts.statusCallback)}"`)
    attrs.push('method="POST"')
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${attrs.join(' ')}><Number>${escapeXmlText(opts.to)}</Number></Dial></Response>`
}

// Inbound (PSTN → browser): when a call comes in to our Twilio number, route
// it to a specific user's Voice SDK client. The "identity" string here MUST
// match the identity used when minting that user's Voice Access Token.
export function twimlDialClient(opts: {
  identity: string
  callerId?: string
  timeoutSeconds?: number
  recordCalls?: boolean
  recordingStatusCallback?: string
  statusCallback?: string
}): string {
  const attrs: string[] = []
  if (opts.callerId) attrs.push(`callerId="${escapeXmlAttr(opts.callerId)}"`)
  if (opts.timeoutSeconds) attrs.push(`timeout="${opts.timeoutSeconds}"`)
  if (opts.recordCalls) {
    attrs.push('record="record-from-answer"')
    if (opts.recordingStatusCallback) {
      attrs.push(
        `recordingStatusCallback="${escapeXmlAttr(opts.recordingStatusCallback)}"`
      )
      attrs.push('recordingStatusCallbackMethod="POST"')
    }
  }
  if (opts.statusCallback) {
    attrs.push(`action="${escapeXmlAttr(opts.statusCallback)}"`)
    attrs.push('method="POST"')
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${attrs.join(' ')}><Client>${escapeXmlText(opts.identity)}</Client></Dial></Response>`
}

// Polite hangup with a spoken message. Used as a last-resort fallback when
// voicemail isn't configured or the recording webhook fails.
export function twimlSayAndHangup(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">${escapeXmlText(message)}</Say></Response>`
}

// Voicemail recording flow. Plays the configured greeting (audio URL) or
// falls back to a spoken default, then records up to maxLength seconds and
// POSTs to the action URL when finished. action is hit twice by Twilio:
// once after the recording is finalized (with RecordingSid/RecordingUrl
// populated) and once if the caller hangs up before recording finishes.
export function twimlRecordVoicemail(opts: {
  action: string
  greetingUrl?: string | null
  spokenFallback?: string
  maxLengthSec?: number
}): string {
  const maxLen = Math.max(15, Math.min(300, opts.maxLengthSec ?? 180))
  const fallback = opts.spokenFallback ||
    "Please leave a message after the beep. Press pound when finished."

  const intro = opts.greetingUrl
    ? `<Play>${escapeXmlText(opts.greetingUrl)}</Play>`
    : `<Say voice="alice">${escapeXmlText(fallback)}</Say>`

  const recordAttrs = [
    `action="${escapeXmlAttr(opts.action)}"`,
    'method="POST"',
    `maxLength="${maxLen}"`,
    'playBeep="true"',
    'trim="trim-silence"',
    'finishOnKey="#"',
  ].join(' ')

  return `<?xml version="1.0" encoding="UTF-8"?><Response>${intro}<Record ${recordAttrs}/><Say voice="alice">We didn't catch that. Goodbye.</Say></Response>`
}

// ---------------------------------------------------------------------------
// Webhook signature validation. Reuses the SMS pattern from lib/twilio.ts —
// same algorithm, same AUTH_TOKEN. Kept here so Dialer routes don't have to
// reach into lib/twilio.ts and create a cross-module dependency.
// ---------------------------------------------------------------------------

export function validateTwilioVoiceSignature(
  url: string,
  params: Record<string, string>,
  headerSignature: string | null
): boolean {
  if (!AUTH_TOKEN || !headerSignature) return false
  const sortedKeys = Object.keys(params).sort()
  let data = url
  for (const key of sortedKeys) data += key + params[key]
  const computed = crypto
    .createHmac('sha1', AUTH_TOKEN)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64')
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(headerSignature))
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Twilio Voice REST helpers. Limited scope for v1: fetch a recording's bytes
// so we can store it in our R2 bucket. Twilio recordings are private by
// default and require basic auth to download.
// ---------------------------------------------------------------------------

export async function downloadTwilioRecording(
  mediaUrl: string
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!ACCOUNT_SID || !AUTH_TOKEN) return null
  // Append .mp3 for mp3 output (Twilio default is WAV)
  const url = mediaUrl.endsWith('.mp3') || mediaUrl.endsWith('.wav')
    ? mediaUrl
    : `${mediaUrl}.mp3`
  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
    redirect: 'follow',
  })
  if (!res.ok) return null
  const buffer = await res.arrayBuffer()
  return {
    bytes: new Uint8Array(buffer),
    contentType: res.headers.get('content-type') || 'audio/mpeg',
  }
}

// ---------------------------------------------------------------------------
// IVR (Auto-Attendant) — Session 59
//
// ivr_config jsonb shape on dialer_settings:
//   {
//     trees: {
//       default:    { root_node_id, nodes: { [id]: IvrNode } },
//       after_hours?: { ... },   // Session 61
//       holiday?:     { ... },   // Session 61
//     }
//   }
//
// Node kinds (v1):
//   say              — speak text or play audio, then hang up
//   submenu          — prompt + Gather, route on keypress
//   voicemail        — fall through to the general voicemail flow
//   transfer_user    — Dial <Client>identity</Client> (specific Hub user)
//   transfer_pstn    — Dial <Number>+1...</Number>
//   hangup           — bare hangup
//   repeat           — re-render the current node (used only as a no_input/invalid action)
//
// Scaffolded for Session 60 (returns voicemail fallback for now):
//   extension, ring_group
// ---------------------------------------------------------------------------

export type IvrPrompt =
  | { kind: 'tts'; text: string }
  | { kind: 'audio'; audio_url: string }

export type IvrAction =
  | { kind: 'submenu'; target_node_id: string }
  | { kind: 'voicemail' }
  | { kind: 'transfer_user'; user_id: string; identity: string; timeout_sec?: number }
  | { kind: 'transfer_pstn'; number: string; timeout_sec?: number }
  | { kind: 'hangup' }
  | { kind: 'say'; prompt: IvrPrompt }
  | { kind: 'repeat'; max_repeats?: number; then?: IvrAction }
  // Disabled v1 — Session 60:
  | { kind: 'extension'; extension: string }
  | { kind: 'ring_group'; ring_group_id: string }

export type IvrNode = {
  id: string
  label?: string
  prompt: IvrPrompt
  keypresses: Partial<Record<'0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '*' | '#', IvrAction>>
  no_input?: IvrAction
  invalid_input?: IvrAction
  gather_timeout_sec?: number
}

export type IvrTree = {
  root_node_id: string
  nodes: Record<string, IvrNode>
}

export type IvrConfig = {
  trees: {
    default?: IvrTree
    after_hours?: IvrTree
    holiday?: IvrTree
  }
}

export type IvrTreeName = 'default' | 'after_hours' | 'holiday'

function renderPrompt(p: IvrPrompt | undefined | null): string {
  if (!p) return ''
  if (p.kind === 'audio' && p.audio_url) {
    return `<Play>${escapeXmlText(p.audio_url)}</Play>`
  }
  if (p.kind === 'tts' && p.text) {
    return `<Say voice="alice">${escapeXmlText(p.text)}</Say>`
  }
  return ''
}

function safeUrl(s: string): string {
  return escapeXmlAttr(s)
}

// Render TwiML for a terminal/leaf action (everything except 'submenu' and 'repeat').
// `baseUrl` is the absolute origin (e.g. https://staging.lynxedo.com) used to build
// action callback URLs. `actionUrls` provides the voicemail render route + status callback.
function renderTerminalAction(
  action: IvrAction,
  opts: {
    baseUrl: string
    voicemailRouteUrl: string  // /api/dialer/voice/twiml/ivr-voicemail
    statusCallback?: string
    callerId?: string
  }
): string {
  switch (action.kind) {
    case 'voicemail':
      // Redirect into the voicemail render route (mirrors the inbound no-answer
      // flow from Session 58 — that route renders twimlRecordVoicemail).
      return `<Redirect method="POST">${safeUrl(opts.voicemailRouteUrl)}</Redirect>`

    case 'transfer_user': {
      // <Dial action="..."> handles fall-through on no-answer/busy/failed by
      // POSTing to the action URL with DialCallStatus. We point that at the
      // existing voicemail render route, which returns empty TwiML when the
      // call was answered (cleanly hangs up) or renders the record flow when
      // it wasn't.
      const attrs: string[] = []
      if (opts.callerId) attrs.push(`callerId="${safeUrl(opts.callerId)}"`)
      attrs.push(`timeout="${action.timeout_sec ?? 20}"`)
      attrs.push(`action="${safeUrl(opts.voicemailRouteUrl)}"`)
      attrs.push('method="POST"')
      return `<Dial ${attrs.join(' ')}><Client>${escapeXmlText(action.identity)}</Client></Dial>`
    }

    case 'transfer_pstn': {
      const attrs: string[] = []
      if (opts.callerId) attrs.push(`callerId="${safeUrl(opts.callerId)}"`)
      attrs.push(`timeout="${action.timeout_sec ?? 25}"`)
      attrs.push(`action="${safeUrl(opts.voicemailRouteUrl)}"`)
      attrs.push('method="POST"')
      return `<Dial ${attrs.join(' ')}><Number>${escapeXmlText(action.number)}</Number></Dial>`
    }

    case 'say': {
      // Speak the prompt then hang up.
      return `${renderPrompt(action.prompt)}<Hangup/>`
    }

    case 'hangup':
      return `<Hangup/>`

    // Scaffolded — Session 60 will replace these. For now both fall through to voicemail.
    case 'extension':
    case 'ring_group':
      return `<Redirect method="POST">${safeUrl(opts.voicemailRouteUrl)}</Redirect>`

    // Submenu and repeat are not terminal — caller should handle them upstream.
    case 'submenu':
    case 'repeat':
      return `<Redirect method="POST">${safeUrl(opts.voicemailRouteUrl)}</Redirect>`

    default:
      return `<Redirect method="POST">${safeUrl(opts.voicemailRouteUrl)}</Redirect>`
  }
}

// Render TwiML for a node. If the node has any keypresses defined, wraps the
// prompt in a <Gather>; otherwise just plays the prompt and hangs up.
//
// The Gather's action URL points back at the IVR handler so Twilio POSTs the
// caller's keypress (Digits param) and we can render the matching child node.
//
// `repeatCount` is read from the inbound request (query param `r`) so we can
// enforce no_input.max_repeats — the gather handler increments it on each
// retry and falls through to no_input.then once the limit is hit.
export function twimlRenderIvrNode(opts: {
  config: IvrConfig
  treeName: IvrTreeName
  nodeId: string
  baseUrl: string
  // /api/dialer/voice/twiml/ivr — handler that processes Digits and routes
  gatherActionUrlFor: (treeName: IvrTreeName, nodeId: string, repeatCount: number) => string
  voicemailRouteUrl: string
  statusCallback?: string
  callerId?: string
  repeatCount?: number
}): string {
  const tree = opts.config.trees?.[opts.treeName]
  if (!tree) {
    // Misconfigured — bail to voicemail.
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${safeUrl(opts.voicemailRouteUrl)}</Redirect></Response>`
  }
  const node = tree.nodes?.[opts.nodeId]
  if (!node) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${safeUrl(opts.voicemailRouteUrl)}</Redirect></Response>`
  }

  const keypresses = Object.entries(node.keypresses || {})
  const repeatCount = opts.repeatCount ?? 0

  // No keypresses defined → terminal node, just play the prompt and stop.
  if (keypresses.length === 0) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${renderPrompt(node.prompt)}<Hangup/></Response>`
  }

  // Build the Gather. numDigits=1 since all our actions are single-digit.
  const gatherTimeout = node.gather_timeout_sec ?? 6
  const actionUrl = opts.gatherActionUrlFor(opts.treeName, node.id, repeatCount)
  const gatherAttrs = [
    'input="dtmf"',
    'numDigits="1"',
    `timeout="${gatherTimeout}"`,
    `action="${safeUrl(actionUrl)}"`,
    'method="POST"',
    'actionOnEmptyResult="true"',
  ].join(' ')

  // The no_input fallback fires when Twilio POSTs to the action URL with an
  // empty `Digits` param (caller didn't press anything). We handle that in the
  // gather handler route, not inline here.
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather ${gatherAttrs}>${renderPrompt(node.prompt)}</Gather><Redirect method="POST">${safeUrl(actionUrl)}</Redirect></Response>`
}

// Render the result of a single keypress — used by the gather handler route.
export function twimlRenderIvrAction(opts: {
  action: IvrAction
  config: IvrConfig
  treeName: IvrTreeName
  baseUrl: string
  gatherActionUrlFor: (treeName: IvrTreeName, nodeId: string, repeatCount: number) => string
  voicemailRouteUrl: string
  statusCallback?: string
  callerId?: string
}): string {
  // Submenu → render the target node (with a fresh Gather).
  if (opts.action.kind === 'submenu') {
    return twimlRenderIvrNode({
      config: opts.config,
      treeName: opts.treeName,
      nodeId: opts.action.target_node_id,
      baseUrl: opts.baseUrl,
      gatherActionUrlFor: opts.gatherActionUrlFor,
      voicemailRouteUrl: opts.voicemailRouteUrl,
      statusCallback: opts.statusCallback,
      callerId: opts.callerId,
      repeatCount: 0,
    })
  }

  // Everything else is a terminal action.
  const inner = renderTerminalAction(opts.action, {
    baseUrl: opts.baseUrl,
    voicemailRouteUrl: opts.voicemailRouteUrl,
    statusCallback: opts.statusCallback,
    callerId: opts.callerId,
  })
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`
}

// Re-render the current node with an incremented repeat counter. Used when
// the caller hits no_input or invalid_input and the action is 'repeat'.
export function twimlRenderIvrRepeat(opts: {
  config: IvrConfig
  treeName: IvrTreeName
  nodeId: string
  baseUrl: string
  gatherActionUrlFor: (treeName: IvrTreeName, nodeId: string, repeatCount: number) => string
  voicemailRouteUrl: string
  statusCallback?: string
  callerId?: string
  repeatCount: number
  maxRepeats: number
  fallback: IvrAction | undefined
}): string {
  if (opts.repeatCount >= opts.maxRepeats) {
    const fallback = opts.fallback ?? { kind: 'voicemail' as const }
    return twimlRenderIvrAction({
      action: fallback,
      config: opts.config,
      treeName: opts.treeName,
      baseUrl: opts.baseUrl,
      gatherActionUrlFor: opts.gatherActionUrlFor,
      voicemailRouteUrl: opts.voicemailRouteUrl,
      statusCallback: opts.statusCallback,
      callerId: opts.callerId,
    })
  }
  return twimlRenderIvrNode({
    config: opts.config,
    treeName: opts.treeName,
    nodeId: opts.nodeId,
    baseUrl: opts.baseUrl,
    gatherActionUrlFor: opts.gatherActionUrlFor,
    voicemailRouteUrl: opts.voicemailRouteUrl,
    statusCallback: opts.statusCallback,
    callerId: opts.callerId,
    repeatCount: opts.repeatCount + 1,
  })
}

// E.164 normalizer — re-exported here so dialer code doesn't have to import
// from lib/twilio.ts. Same implementation.
export function toE164(raw: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '')
    return digits.length >= 10 ? '+' + digits : null
  }
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  return null
}
