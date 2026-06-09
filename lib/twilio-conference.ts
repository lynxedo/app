// Twilio Conference helpers — server-side. Phase 3 of the Dialer call-control
// roadmap moves active calls off the plain point-to-point <Dial> onto a per-call
// <Conference> room, which is what unlocks real hold-music, blind (cold) transfer,
// and warm (consult-then-merge) transfer — all driven through Twilio's REST
// Participants API.
//
// Raw REST (no `twilio` npm package — only the browser-side @twilio/voice-sdk is a
// dependency), mirroring the fetch+basic-auth pattern in lib/twilio-voice.ts
// (startCallRecording / downloadTwilioRecording). Keeping it dependency-free
// avoids package-lock churn on deploy.
//
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------
// Each active call = one named conference room. Participants carry a `label`
// (twilio's participant label) so every later action addresses them by label —
// no need to persist participant CallSids:
//   - 'customer'  : the PSTN party (outbound: the dialed number; inbound: the caller)
//   - 'agent'     : the Hub user's Client leg (the SDK / CallKit connection)
//   - 'transfer'  : a warm/cold transfer target (Client or PSTN)
//
// endConferenceOnExit: everyone joins with `true` so a normal hangup ends the
// call cleanly. Right before a TRANSFER removes the agent, we flip the agent's
// flag to `false` (via participant update) so dropping the agent leaves
// customer+target connected. The customer always keeps `true`, so the customer
// leaving always ends the call.
// ---------------------------------------------------------------------------

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')
}
function accountBase(): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}`
}
function conferenceConfigured(): boolean {
  return Boolean(ACCOUNT_SID && AUTH_TOKEN)
}

// Default hold music. Twilio hosts a small public set of royalty-free clips;
// the classical bucket is a zero-config sane default. A company can override
// via dialer_settings.hold_music_url later (the hold endpoint reads it).
export const DEFAULT_HOLD_MUSIC_URL =
  'http://com.twilio.music.classical.s3.amazonaws.com/BusyStrings.mp3'

// Generate a unique, Twilio-safe conference room name. Room names must be
// <= 100 chars; we keep them short + URL/label safe.
export function conferenceRoomName(): string {
  // crypto.randomUUID is available on Node 20+ (the VPS runtime).
  return `conf_${crypto.randomUUID().replace(/-/g, '')}`
}

// Sanitize a room name that arrives from the client (outbound passes the room it
// generated as a Voice SDK param). Defensive — never trust client input verbatim
// in a Twilio resource path.
export function sanitizeRoomName(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 100)
  return cleaned.length >= 6 ? cleaned : null
}

// ---------------------------------------------------------------------------
// TwiML builders
// ---------------------------------------------------------------------------

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// The Hub user's leg joins the conference. Used for:
//   - outbound: the SDK's outbound call lands here (agent enters first, then we
//     REST-add the dialed number as 'customer').
//   - inbound transfer_user/extension single-agent connect (the agent is added
//     via REST as a participant; the CALLER uses twimlCustomerJoinConference).
//
// startConferenceOnEnter=true so the room "starts" when the agent is present
// (a caller waiting with startConferenceOnEnter=false hears holdMusic until then).
export function twimlAgentJoinConference(opts: {
  room: string
  label?: string
  record?: boolean
  recordingStatusCallback?: string
  statusCallback?: string
  endConferenceOnExit?: boolean
  callerId?: string
}): string {
  const confAttrs: string[] = [
    'startConferenceOnEnter="true"',
    `endConferenceOnExit="${opts.endConferenceOnExit === false ? 'false' : 'true'}"`,
    'beep="false"',
    `participantLabel="${escapeXmlAttr(opts.label || 'agent')}"`,
  ]
  if (opts.record) {
    confAttrs.push('record="record-from-start"')
    if (opts.recordingStatusCallback) {
      confAttrs.push(
        `recordingStatusCallback="${escapeXmlAttr(opts.recordingStatusCallback)}"`
      )
      confAttrs.push('recordingStatusCallbackMethod="POST"')
    }
  }
  if (opts.statusCallback) {
    confAttrs.push(`statusCallback="${escapeXmlAttr(opts.statusCallback)}"`)
    confAttrs.push('statusCallbackEvent="start end join leave"')
    confAttrs.push('statusCallbackMethod="POST"')
  }
  // The outer <Dial> wraps the conference. callerId is cosmetic for a Client leg
  // but harmless; we include it when known.
  const dialAttrs: string[] = []
  if (opts.callerId) dialAttrs.push(`callerId="${escapeXmlAttr(opts.callerId)}"`)
  const dialOpen = dialAttrs.length ? `<Dial ${dialAttrs.join(' ')}>` : '<Dial>'
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${dialOpen}<Conference ${confAttrs.join(' ')}>${escapeXmlText(opts.room)}</Conference></Dial></Response>`
}

// The inbound CALLER's leg joins the conference and waits (with hold music) for
// an agent to be added via REST. `action` is the <Dial> fall-through — Twilio
// POSTs there when the caller's conference leg ends (e.g. so we can land them in
// voicemail if the agent never joined / hung up).
//
// startConferenceOnEnter=false → the caller does NOT start the conference; they
// hear waitUrl music until an agent (startConferenceOnEnter=true) joins.
export function twimlCustomerJoinConference(opts: {
  room: string
  waitUrl: string
  action?: string
  record?: boolean
  recordingStatusCallback?: string
  statusCallback?: string
}): string {
  const confAttrs: string[] = [
    'startConferenceOnEnter="false"',
    'endConferenceOnExit="true"',
    'beep="false"',
    'participantLabel="customer"',
    `waitUrl="${escapeXmlAttr(opts.waitUrl)}"`,
  ]
  if (opts.record) {
    confAttrs.push('record="record-from-start"')
    if (opts.recordingStatusCallback) {
      confAttrs.push(
        `recordingStatusCallback="${escapeXmlAttr(opts.recordingStatusCallback)}"`
      )
      confAttrs.push('recordingStatusCallbackMethod="POST"')
    }
  }
  if (opts.statusCallback) {
    confAttrs.push(`statusCallback="${escapeXmlAttr(opts.statusCallback)}"`)
    confAttrs.push('statusCallbackEvent="start end join leave"')
    confAttrs.push('statusCallbackMethod="POST"')
  }
  const dialAttrs: string[] = []
  if (opts.action) {
    dialAttrs.push(`action="${escapeXmlAttr(opts.action)}"`)
    dialAttrs.push('method="POST"')
  }
  const dialOpen = dialAttrs.length ? `<Dial ${dialAttrs.join(' ')}>` : '<Dial>'
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${dialOpen}<Conference ${confAttrs.join(' ')}>${escapeXmlText(opts.room)}</Conference></Dial></Response>`
}

// Looping hold music — served at /api/dialer/voice/twiml/hold-music and used as
// both the caller waitUrl and the held-participant HoldUrl. loop="0" repeats
// until the participant is unheld / the agent joins.
export function twimlHoldMusic(musicUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Play loop="0">${escapeXmlText(musicUrl)}</Play></Response>`
}

// ---------------------------------------------------------------------------
// REST: Conference Participants API
//   POST   /Conferences/{Room}/Participants                 → add (dials To, joins on answer)
//   POST   /Conferences/{Room}/Participants/{CallSidOrLabel} → update (hold, endConferenceOnExit, …)
//   DELETE /Conferences/{Room}/Participants/{CallSidOrLabel} → remove (drops that leg)
//
// Twilio lets a participant be addressed by its CallSid OR its label, so all of
// these key off the label we set at join time.
// ---------------------------------------------------------------------------

type RestResult = { ok: true; data: Record<string, unknown> } | { ok: false; status: number; code?: number; message?: string }

async function twilioPost(path: string, form: Record<string, string>): Promise<RestResult> {
  if (!conferenceConfigured()) return { ok: false, status: 0, message: 'twilio_not_configured' }
  try {
    const res = await fetch(`${accountBase()}${path}`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.ok) return { ok: true, data: json }
    return { ok: false, status: res.status, code: json.code as number | undefined, message: json.message as string | undefined }
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : 'fetch_failed' }
  }
}

async function twilioDelete(path: string): Promise<RestResult> {
  if (!conferenceConfigured()) return { ok: false, status: 0, message: 'twilio_not_configured' }
  try {
    const res = await fetch(`${accountBase()}${path}`, {
      method: 'DELETE',
      headers: { Authorization: authHeader() },
    })
    if (res.ok || res.status === 204) return { ok: true, data: {} }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: false, status: res.status, code: json.code as number | undefined, message: json.message as string | undefined }
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : 'fetch_failed' }
  }
}

// Add a participant to a conference. Twilio DIALS `to` (a PSTN number like
// '+1...' or a Client like 'client:<identity>') and joins them into `room` on
// answer — creating the conference (by FriendlyName) if it doesn't yet exist.
// Returns BOTH the new participant's CallSid AND the resolved ConferenceSid
// (CFxxxx) so callers can persist them and address this leg later by real SID
// (NOT by room name / label, which don't reliably resolve for update/delete).
export async function addConferenceParticipant(opts: {
  room: string
  to: string
  from: string
  label: string
  startConferenceOnEnter?: boolean
  endConferenceOnExit?: boolean
  timeoutSec?: number
  statusCallback?: string
  earlyMedia?: boolean
}): Promise<{ ok: true; callSid: string | null; conferenceSid: string | null } | { ok: false; error: string }> {
  const form: Record<string, string> = {
    To: opts.to,
    From: opts.from,
    Label: opts.label,
    StartConferenceOnEnter: String(opts.startConferenceOnEnter ?? true),
    EndConferenceOnExit: String(opts.endConferenceOnExit ?? true),
  }
  if (opts.timeoutSec) form.Timeout = String(opts.timeoutSec)
  if (opts.earlyMedia !== undefined) form.EarlyMedia = String(opts.earlyMedia)
  if (opts.statusCallback) {
    form.StatusCallback = opts.statusCallback
    form.StatusCallbackEvent = 'initiated ringing answered completed'
    form.StatusCallbackMethod = 'POST'
  }
  const res = await twilioPost(`/Conferences/${encodeURIComponent(opts.room)}/Participants.json`, form)
  if (res.ok) {
    return {
      ok: true,
      callSid: (res.data.call_sid as string) || null,
      conferenceSid: (res.data.conference_sid as string) || null,
    }
  }
  return { ok: false, error: `${res.code ?? res.status}: ${res.message ?? 'add_participant_failed'}` }
}

// Hold / unhold a participant, addressed by real ConferenceSid + CallSid.
// Holding plays HoldUrl TwiML (our looping music) to that participant and drops
// them out of the audio mix; the rest of the conference is unaffected.
export async function holdParticipant(opts: {
  conferenceSid: string
  callSid: string
  hold: boolean
  holdUrl?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const form: Record<string, string> = { Hold: String(opts.hold) }
  if (opts.hold && opts.holdUrl) form.HoldUrl = opts.holdUrl
  const res = await twilioPost(
    `/Conferences/${encodeURIComponent(opts.conferenceSid)}/Participants/${encodeURIComponent(opts.callSid)}.json`,
    form
  )
  return res.ok ? { ok: true } : { ok: false, error: `${res.code ?? res.status}: ${res.message ?? 'hold_failed'}` }
}

// Update a participant's flags (by real SID) — used to flip the agent's
// endConferenceOnExit to false right before a transfer removes them, so the
// conference survives the agent leaving.
export async function updateParticipant(opts: {
  conferenceSid: string
  callSid: string
  endConferenceOnExit?: boolean
  muted?: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const form: Record<string, string> = {}
  if (opts.endConferenceOnExit !== undefined) form.EndConferenceOnExit = String(opts.endConferenceOnExit)
  if (opts.muted !== undefined) form.Muted = String(opts.muted)
  if (Object.keys(form).length === 0) return { ok: true }
  const res = await twilioPost(
    `/Conferences/${encodeURIComponent(opts.conferenceSid)}/Participants/${encodeURIComponent(opts.callSid)}.json`,
    form
  )
  return res.ok ? { ok: true } : { ok: false, error: `${res.code ?? res.status}: ${res.message ?? 'update_failed'}` }
}

// Remove a participant (by real SID) — drops that one leg, leaving the rest of
// the conference connected. Used to drop the agent after a transfer.
export async function removeParticipant(opts: {
  conferenceSid: string
  callSid: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await twilioDelete(
    `/Conferences/${encodeURIComponent(opts.conferenceSid)}/Participants/${encodeURIComponent(opts.callSid)}.json`
  )
  return res.ok ? { ok: true } : { ok: false, error: `${res.code ?? res.status}: ${res.message ?? 'remove_failed'}` }
}

// Redirect a live call to fresh TwiML (replaces whatever it's doing now). Used
// to pull the inbound caller out of a conference into voicemail when the agent
// never answered.
export async function redirectCall(opts: {
  callSid: string
  twimlUrl: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await twilioPost(`/Calls/${encodeURIComponent(opts.callSid)}.json`, {
    Url: opts.twimlUrl,
    Method: 'POST',
  })
  return res.ok ? { ok: true } : { ok: false, error: `${res.code ?? res.status}: ${res.message ?? 'redirect_failed'}` }
}
