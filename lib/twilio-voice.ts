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
// NT7: DND schedule evaluation lives in the client-safe lib/dnd-schedule.ts.
// Import the types for this module's business-hours helpers; re-export the
// functions + types below so existing `@/lib/twilio-voice` importers are unaffected.
import type { DndSchedule } from '@/lib/dnd-schedule'

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

// Twilio Mobile Push Credential SIDs — the resources that let Twilio deliver an
// incoming-call VoIP push to a native device. These are resource identifiers
// (not secrets); an env var overrides the default if ever rotated.
const IOS_PUSH_CREDENTIAL_SID =
  process.env.TWILIO_PUSH_CREDENTIAL_SID_IOS || 'CR8dedcf7141f714818318ef127ceae13a'
const ANDROID_PUSH_CREDENTIAL_SID =
  process.env.TWILIO_PUSH_CREDENTIAL_SID_ANDROID || 'CRe74ebc43db49f54eda74cb2042d1d42e'

/** The push-credential SID to embed in a native client's access token, or
 *  undefined for web (which receives calls over its live signaling socket). */
export function pushCredentialSidForPlatform(platform?: string): string | undefined {
  if (platform === 'ios') return IOS_PUSH_CREDENTIAL_SID || undefined
  if (platform === 'android') return ANDROID_PUSH_CREDENTIAL_SID || undefined
  return undefined
}

export async function mintVoiceAccessToken(opts: {
  identity: string
  ttlSeconds?: number
  // Native clients (iOS/Android) receive incoming calls via a push notification.
  // Twilio only sends that push if the VoiceGrant names the platform's push
  // credential SID. The browser SDK holds a live signaling socket and doesn't
  // need this. Omit for web; pass the matching CR... SID for native.
  pushCredentialSid?: string
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

  // push_credential_sid is a sibling of incoming/outgoing at the voice-grant
  // level (matches Twilio's VoiceGrant.toPayload). Nesting it inside `incoming`
  // makes Twilio silently ignore it — and no incoming VoIP push is sent.
  const voice: {
    incoming: { allow: boolean }
    outgoing: { application_sid: string }
    push_credential_sid?: string
  } = {
    incoming: { allow: true },
    outgoing: {
      application_sid: TWIML_APP_SID,
    },
  }
  if (opts.pushCredentialSid) {
    voice.push_credential_sid = opts.pushCredentialSid
  }

  const grants = {
    identity: opts.identity,
    voice,
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
    attrs.push('record="record-from-answer-dual"')
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
    attrs.push('record="record-from-answer-dual"')
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
//
// Session 60: callers can append `owner_user_id` to the action URL via query
// param so /voicemail/complete knows which user's box this lands in. The
// greetingUrl can also be per-user (resolved by the caller).
export function twimlRecordVoicemail(opts: {
  action: string
  greetingUrl?: string | null
  greetingTts?: string | null
  spokenFallback?: string
  maxLengthSec?: number
}): string {
  const maxLen = Math.max(15, Math.min(300, opts.maxLengthSec ?? 180))
  const fallback = opts.spokenFallback ||
    "Please leave a message after the beep. Press pound when finished."

  // Priority: uploaded audio > typed TTS > spoken default
  const intro = opts.greetingUrl
    ? `<Play>${escapeXmlText(opts.greetingUrl)}</Play>`
    : opts.greetingTts?.trim()
      ? `<Say voice="alice">${escapeXmlText(opts.greetingTts.trim())}</Say>`
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

// Delete a recording from Twilio's storage. Called after the audio has been
// copied to R2 so we don't pay Twilio storage fees on a duplicate. A 404 counts
// as success (already gone). Never throws.
export async function deleteTwilioRecording(recordingSid: string): Promise<boolean> {
  if (!ACCOUNT_SID || !AUTH_TOKEN || !recordingSid) return false
  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/${encodeURIComponent(recordingSid)}.json`,
      { method: 'DELETE', headers: { Authorization: `Basic ${auth}` } }
    )
    if (res.ok || res.status === 404) return true
    console.warn(`[dialer.recording] deleteTwilioRecording failed for ${recordingSid}: HTTP ${res.status}`)
    return false
  } catch (e) {
    console.warn('[dialer.recording] deleteTwilioRecording threw:', e)
    return false
  }
}

// Start a dual-channel recording on a live call via the REST API. Used for
// INBOUND calls, which flow through the IVR / ring groups — per-<Dial> record
// attributes would miss those, but a call-level recording captures the whole
// thing regardless of routing. Fire-and-forget; failures never block the call.
// Returns the RecordingSid on success, null otherwise.
//
// Twilio error 21220 ("not eligible for recording") fires when the inbound leg
// hasn't been answered/bridged yet — the webhook fires as TwiML starts but the
// call isn't recordable until it's in-progress. Retry with backoff so we catch
// it a beat later without ever blocking the webhook response.
export async function startCallRecording(
  callSid: string,
  recordingStatusCallback: string
): Promise<string | null> {
  if (!ACCOUNT_SID || !AUTH_TOKEN || !callSid) return null
  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Calls/${encodeURIComponent(callSid)}/Recordings.json`
  const body = new URLSearchParams({
    RecordingChannels: 'dual',
    RecordingTrack: 'both',
    RecordingStatusCallback: recordingStatusCallback,
    RecordingStatusCallbackEvent: 'completed',
    RecordingStatusCallbackMethod: 'POST',
  })

  const tryOnce = async () => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })
    if (res.ok) {
      const json = (await res.json()) as { sid?: string }
      return { ok: true as const, sid: json.sid || null }
    }
    const err = await res.json().catch(() => ({})) as { code?: number; message?: string }
    return { ok: false as const, code: err.code, message: err.message }
  }

  try {
    const first = await tryOnce()
    if (first.ok) return first.sid

    // 21220 = leg not yet recordable. Retry with increasing backoff — the call
    // becomes recordable once it's in-progress (a beat after TwiML executes).
    if (first.code === 21220) {
      for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 1500 * (i + 1)))
        const retry = await tryOnce()
        if (retry.ok) {
          console.log(`[dialer.recording] startCallRecording ok on retry ${i + 1} for ${callSid}`)
          return retry.sid
        }
        console.warn(`[dialer.recording] startCallRecording retry ${i + 1} for ${callSid}: code=${retry.code} ${retry.message}`)
        if (retry.code !== 21220) break
      }
    } else {
      console.warn(`[dialer.recording] startCallRecording failed for ${callSid}: code=${first.code} ${first.message}`)
    }
  } catch (e) {
    console.warn('[dialer.recording] startCallRecording threw:', e)
  }
  return null
}

// Inject a brief "this call may be recorded" notice at the very start of any
// TwiML <Response>. Works across every inbound path (IVR menu, dial, voicemail)
// because every builder here emits `...<Response>...`. Only applied when
// recording is enabled, so callers hear it exactly when recording happens.
export function injectConsentNotice(
  twiml: string,
  notice: string,
  opts?: { url?: string | null; enabled?: boolean }
): string {
  // If consent notice is explicitly disabled, skip it entirely
  if (opts?.enabled === false) return twiml
  if (!notice && !opts?.url) return twiml
  // Uploaded audio takes priority over TTS text
  const announcement = opts?.url?.trim()
    ? `<Play>${escapeXmlText(opts.url.trim())}</Play>`
    : `<Say voice="alice">${escapeXmlText(notice)}</Say>`
  return twiml.replace('<Response>', `<Response>${announcement}`)
}

export const DEFAULT_RECORDING_CONSENT_NOTICE =
  'This call may be recorded for quality and training purposes.'

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
// Session 60 (now enabled):
//   extension     — dial a specific user's <Client>identity</Client> looked up by extension
//   ring_group    — dial a configured ring group (simultaneous or sequential)
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
//
// Session 60: `extensionResolver` and `ringGroupUrlFor` let us turn the
// scaffolded extension + ring_group actions into real TwiML. Both fall through
// to the company general voicemail on miss (caller passes the URL).
function renderTerminalAction(
  action: IvrAction,
  opts: {
    baseUrl: string
    voicemailRouteUrl: string  // company general voicemail render
    statusCallback?: string
    callerId?: string
    extensionResolver?: (ext: string) => { identity: string; ownerUserId: string } | null
    ringGroupUrlFor?: (groupId: string, index: number) => string
    perUserVoicemailUrlFor?: (ownerUserId: string) => string
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
      // per-user voicemail render route so unanswered calls land in that
      // user's box (falls back to general if no per-user route fn).
      const fallback = opts.perUserVoicemailUrlFor
        ? opts.perUserVoicemailUrlFor(action.user_id)
        : opts.voicemailRouteUrl
      const attrs: string[] = []
      if (opts.callerId) attrs.push(`callerId="${safeUrl(opts.callerId)}"`)
      attrs.push(`timeout="${action.timeout_sec ?? 20}"`)
      attrs.push(`action="${safeUrl(fallback)}"`)
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

    // Session 60: extension — look up which user owns the extension, dial them
    // by Client identity. Fall through to that user's voicemail on no-answer
    // (or company general if no per-user route fn or no resolver hit).
    case 'extension': {
      const resolved = opts.extensionResolver?.(action.extension)
      if (!resolved) {
        // Extension not assigned — bail to general voicemail.
        return `<Redirect method="POST">${safeUrl(opts.voicemailRouteUrl)}</Redirect>`
      }
      const fallback = opts.perUserVoicemailUrlFor
        ? opts.perUserVoicemailUrlFor(resolved.ownerUserId)
        : opts.voicemailRouteUrl
      const attrs: string[] = []
      if (opts.callerId) attrs.push(`callerId="${safeUrl(opts.callerId)}"`)
      attrs.push('timeout="20"')
      attrs.push(`action="${safeUrl(fallback)}"`)
      attrs.push('method="POST"')
      return `<Dial ${attrs.join(' ')}><Client>${escapeXmlText(resolved.identity)}</Client></Dial>`
    }

    // Session 60: ring_group — redirect to the dedicated ring-group handler.
    // That route owns the simultaneous vs sequential branching since
    // sequential needs multi-step <Dial action=...> step-through.
    case 'ring_group': {
      if (!opts.ringGroupUrlFor) {
        return `<Redirect method="POST">${safeUrl(opts.voicemailRouteUrl)}</Redirect>`
      }
      const url = opts.ringGroupUrlFor(action.ring_group_id, 0)
      return `<Redirect method="POST">${safeUrl(url)}</Redirect>`
    }

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
  // Session 60: optional resolvers for the new extension + ring_group + per-user VM actions.
  extensionResolver?: (ext: string) => { identity: string; ownerUserId: string } | null
  ringGroupUrlFor?: (groupId: string, index: number) => string
  perUserVoicemailUrlFor?: (ownerUserId: string) => string
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
  extensionResolver?: (ext: string) => { identity: string; ownerUserId: string } | null
  ringGroupUrlFor?: (groupId: string, index: number) => string
  perUserVoicemailUrlFor?: (ownerUserId: string) => string
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
      extensionResolver: opts.extensionResolver,
      ringGroupUrlFor: opts.ringGroupUrlFor,
      perUserVoicemailUrlFor: opts.perUserVoicemailUrlFor,
    })
  }

  // Everything else is a terminal action.
  const inner = renderTerminalAction(opts.action, {
    baseUrl: opts.baseUrl,
    voicemailRouteUrl: opts.voicemailRouteUrl,
    statusCallback: opts.statusCallback,
    callerId: opts.callerId,
    extensionResolver: opts.extensionResolver,
    ringGroupUrlFor: opts.ringGroupUrlFor,
    perUserVoicemailUrlFor: opts.perUserVoicemailUrlFor,
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
  extensionResolver?: (ext: string) => { identity: string; ownerUserId: string } | null
  ringGroupUrlFor?: (groupId: string, index: number) => string
  perUserVoicemailUrlFor?: (ownerUserId: string) => string
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
      extensionResolver: opts.extensionResolver,
      ringGroupUrlFor: opts.ringGroupUrlFor,
      perUserVoicemailUrlFor: opts.perUserVoicemailUrlFor,
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
    extensionResolver: opts.extensionResolver,
    ringGroupUrlFor: opts.ringGroupUrlFor,
    perUserVoicemailUrlFor: opts.perUserVoicemailUrlFor,
  })
}

// ---------------------------------------------------------------------------
// Session 60 — Ring groups + DND
// ---------------------------------------------------------------------------

// Simultaneous ring: one <Dial> with multiple <Client> children. Whichever
// answers first connects; the rest get cancelled. <Dial action=> handles
// fall-through to the group's no-answer destination.
export function twimlRingGroupSimultaneous(opts: {
  identities: string[]
  callerId?: string
  timeoutSec: number
  actionUrl: string
}): string {
  if (opts.identities.length === 0) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${safeUrl(opts.actionUrl)}</Redirect></Response>`
  }
  const attrs: string[] = []
  if (opts.callerId) attrs.push(`callerId="${safeUrl(opts.callerId)}"`)
  attrs.push(`timeout="${opts.timeoutSec}"`)
  attrs.push(`action="${safeUrl(opts.actionUrl)}"`)
  attrs.push('method="POST"')
  const clients = opts.identities
    .map((id) => `<Client>${escapeXmlText(id)}</Client>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${attrs.join(' ')}>${clients}</Dial></Response>`
}

// Sequential ring: dial ONE member, with <Dial action=> pointing back at the
// ring-group route with index incremented. That route checks DialCallStatus —
// if answered, returns empty TwiML; if not, dials the next member, and so on
// until the list is exhausted (then falls through to the group's fallback).
export function twimlRingGroupSequentialStep(opts: {
  identity: string
  callerId?: string
  timeoutSec: number
  nextStepUrl: string
}): string {
  const attrs: string[] = []
  if (opts.callerId) attrs.push(`callerId="${safeUrl(opts.callerId)}"`)
  attrs.push(`timeout="${opts.timeoutSec}"`)
  attrs.push(`action="${safeUrl(opts.nextStepUrl)}"`)
  attrs.push('method="POST"')
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${attrs.join(' ')}><Client>${escapeXmlText(opts.identity)}</Client></Dial></Response>`
}

// ---------------------------------------------------------------------------
// DND scheduling
//
// dialer_dnd_schedule jsonb shape:
//   {
//     enabled: boolean,                        // master toggle for schedule
//     tz?: string,                              // IANA tz, default America/Chicago
//     days: {
//       mon?: Array<{from: 'HH:mm', to: 'HH:mm'}>,
//       tue?: ..., wed?: ..., thu?: ..., fri?: ..., sat?: ..., sun?: ...
//     }
//   }
//
// A window with from > to wraps midnight (e.g. {from: '18:00', to: '08:00'}
// means 6pm to 8am the next day). Multiple windows per day are OR'd.
// ---------------------------------------------------------------------------

// NT7: re-export the canonical DND types so existing importers of these from
// '@/lib/twilio-voice' keep working. The definitions live in lib/dnd-schedule.ts.
export type { DndWindow, DndSchedule } from '@/lib/dnd-schedule'

const DAY_KEYS: Array<DndSchedule['days'] extends infer X ? keyof NonNullable<X> : never> =
  ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

function parseHm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return null
  const h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

// NT7: isInDndSchedule + userIsDndNow now live in the client-safe
// lib/dnd-schedule.ts (single source of truth). Re-exported here so existing
// '@/lib/twilio-voice' callers (hub-push, dialer routing) keep working.
export { isInDndSchedule, userIsDndNow } from '@/lib/dnd-schedule'

// ---------------------------------------------------------------------------
// Session 61 — After-hours / holiday IVR tree picker
//
// business_hours jsonb shape (same as DndSchedule above so we can reuse parsing):
//   { enabled: bool, tz: 'America/Chicago', days: { mon: [{from:'08:00', to:'18:00'}], ... } }
// "Inside business hours" = now falls in any listed window for today's local day.
// Outside business hours + an `after_hours` IVR tree exists => run after_hours.
//
// holidays jsonb shape (array):
//   [ { kind: 'date', date: 'YYYY-MM-DD', label?: string },
//     { kind: 'recurring', month: 1-12, day: 1-31, label?: string } ]
// Today is a holiday + a `holiday` IVR tree exists => run holiday (overrides after_hours).
//
// Picker order: holiday > after_hours > default. If the chosen tree is missing
// or has no root_node_id we fall back to default so calls don't die.
// ---------------------------------------------------------------------------

export type BusinessHoursSchedule = DndSchedule // identical shape, reuse the parser

export type HolidayEntry =
  | { kind: 'date'; date: string; label?: string }       // YYYY-MM-DD
  | { kind: 'recurring'; month: number; day: number; label?: string }

// True if `now` is inside any window for today's local day in `schedule.tz`.
// Mirrors isInDndSchedule but doesn't consider yesterday's wrap-overnight
// windows — business hours don't realistically span midnight.
export function isWithinBusinessHours(
  schedule: BusinessHoursSchedule | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!schedule || !schedule.enabled || !schedule.days) return false
  const tz = schedule.tz || 'America/Chicago'

  let dayKey: typeof DAY_KEYS[number]
  let nowMin: number
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const parts = fmt.formatToParts(now)
    const wd = parts.find((p) => p.type === 'weekday')?.value || ''
    const hourStr = parts.find((p) => p.type === 'hour')?.value || '0'
    const minStr = parts.find((p) => p.type === 'minute')?.value || '0'
    const map: Record<string, typeof DAY_KEYS[number]> = {
      Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat',
    }
    dayKey = map[wd] || 'mon'
    const h = parseInt(hourStr, 10) % 24
    const m = parseInt(minStr, 10)
    nowMin = h * 60 + m
  } catch {
    return false
  }

  const windows = schedule.days[dayKey]
  if (!windows) return false
  for (const w of windows) {
    const from = parseHm(w.from)
    const to = parseHm(w.to)
    if (from === null || to === null) continue
    if (from === to) continue
    if (from < to) {
      if (nowMin >= from && nowMin < to) return true
    } else {
      // Wrap-overnight (unusual for business hours but support it).
      if (nowMin >= from || nowMin < to) return true
    }
  }
  return false
}

// True if today's local date (in `tz`) matches any entry in `holidays`.
export function isHolidayToday(
  holidays: HolidayEntry[] | null | undefined,
  tz: string = 'America/Chicago',
  now: Date = new Date(),
): boolean {
  if (!Array.isArray(holidays) || holidays.length === 0) return false

  let ymd: string
  let month: number
  let day: number
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const parts = fmt.formatToParts(now)
    const y = parts.find((p) => p.type === 'year')?.value || ''
    const mo = parts.find((p) => p.type === 'month')?.value || ''
    const d = parts.find((p) => p.type === 'day')?.value || ''
    if (!y || !mo || !d) return false
    ymd = `${y}-${mo}-${d}`
    month = parseInt(mo, 10)
    day = parseInt(d, 10)
  } catch {
    return false
  }

  for (const h of holidays) {
    if (!h || typeof h !== 'object') continue
    if (h.kind === 'date' && typeof h.date === 'string' && h.date === ymd) return true
    if (h.kind === 'recurring' && h.month === month && h.day === day) return true
  }
  return false
}

// Decide which IVR tree to run for a given call right now.
// Returns 'holiday' | 'after_hours' | 'default'. The caller is responsible
// for falling back to 'default' if the picked tree is misconfigured.
export function pickIvrTree(opts: {
  config: IvrConfig
  businessHours?: BusinessHoursSchedule | null
  holidays?: HolidayEntry[] | null
  now?: Date
}): IvrTreeName {
  const now = opts.now ?? new Date()
  const tz = opts.businessHours?.tz || 'America/Chicago'

  const hasHoliday = !!opts.config.trees?.holiday?.root_node_id
  if (hasHoliday && isHolidayToday(opts.holidays, tz, now)) return 'holiday'

  const hasAfterHours = !!opts.config.trees?.after_hours?.root_node_id
  if (hasAfterHours && opts.businessHours?.enabled && !isWithinBusinessHours(opts.businessHours, now)) {
    return 'after_hours'
  }

  return 'default'
}

// E.164 normalizer — single source of truth in lib/phone.ts, re-exported here
// so dialer code can keep importing it from lib/twilio-voice.ts.
export { toE164 } from './phone'
