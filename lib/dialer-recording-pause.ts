// Pause or resume ALL active recordings on a live Dialer call.
//
// Primary use: suppress recording while a customer is on HOLD. Holding only
// silences the CUSTOMER (she hears hold music) — the agent's mic stays live in
// the conference, so without this anything the agent says during a hold (to a
// coworker, or on another phone) is captured by the conference recording. We
// pause on hold and resume on unhold so nothing said during a hold is recorded.
//
// A Dialer call can be recorded in TWO places at once: the CONFERENCE
// (record="record-from-start" on <Conference>) and a call leg (the inbound
// startCallRecording REST path). We gather every non-terminal recording across
// both and toggle each by its own parent SIDs.
//
// This mirrors the proven toggle logic in /api/dialer/voice/recording/pause but
// is intentionally standalone, so wiring it into hold/unhold can never regress
// the manual pause button.

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const API = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}`

type Rec = { sid: string; status: string; call_sid?: string | null; conference_sid?: string | null }

export async function setRecordingsPaused(opts: {
  conferenceSid?: string | null
  conferenceName?: string | null
  callSid?: string | null
  paused: boolean
}): Promise<{ ok: boolean; toggled: number; error?: string }> {
  if (!ACCOUNT_SID || !AUTH_TOKEN) return { ok: false, toggled: 0, error: 'twilio_not_configured' }
  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')
  const headers = { Authorization: `Basic ${auth}` }

  // Resolve the live conference SID — look it up by name if not supplied (it's
  // stamped slightly after the call row is created, so it can be briefly null).
  let conferenceSid = opts.conferenceSid ?? null
  if (!conferenceSid && opts.conferenceName) {
    try {
      const r = await fetch(
        `${API}/Conferences.json?FriendlyName=${encodeURIComponent(opts.conferenceName)}&Status=in-progress`,
        { headers }
      )
      if (r.ok) {
        const d = (await r.json()) as { conferences?: { sid: string }[] }
        conferenceSid = d.conferences?.[0]?.sid ?? null
      }
    } catch {
      /* fall through — we can still toggle the call-leg recording */
    }
  }

  // Gather candidate recordings from BOTH the conference and the call leg.
  const listUrls: string[] = []
  if (conferenceSid) listUrls.push(`${API}/Conferences/${encodeURIComponent(conferenceSid)}/Recordings.json`)
  if (opts.callSid) listUrls.push(`${API}/Calls/${encodeURIComponent(opts.callSid)}/Recordings.json`)

  const seen = new Set<string>()
  const recordings: Rec[] = []
  for (const url of listUrls) {
    try {
      const res = await fetch(url, { headers })
      if (!res.ok) continue
      const data = (await res.json()) as { recordings?: Rec[] }
      for (const rec of data.recordings ?? []) {
        if (rec.sid && !seen.has(rec.sid)) {
          seen.add(rec.sid)
          recordings.push(rec)
        }
      }
    } catch {
      /* skip this source */
    }
  }

  // ⚠ The Recordings LIST is not a reliable source of live pause-state: an
  // actively-recording recording AND a paused one both list as 'processing'.
  // So don't infer state from the list — target every non-terminal recording
  // and PATCH it to the desired status (a same-state PATCH is a harmless no-op).
  const targets = recordings.filter(
    (r) => r.status === 'processing' || r.status === 'in-progress' || r.status === 'paused'
  )
  if (targets.length === 0) return { ok: false, toggled: 0, error: 'no_active_recording' }

  const newStatus = opts.paused ? 'paused' : 'in-progress'
  let toggled = 0
  let lastErr: string | undefined
  for (const rec of targets) {
    // Address each recording by its OWN parent resource.
    const base = rec.conference_sid
      ? `${API}/Conferences/${encodeURIComponent(rec.conference_sid)}/Recordings/${encodeURIComponent(rec.sid)}.json`
      : rec.call_sid
        ? `${API}/Calls/${encodeURIComponent(rec.call_sid)}/Recordings/${encodeURIComponent(rec.sid)}.json`
        : null
    if (!base) continue
    // PauseBehavior is only valid when pausing; 'silence' keeps the recording
    // timeline intact (silent gap) so transcript timestamps stay aligned.
    const form: Record<string, string> = { Status: newStatus }
    if (opts.paused) form.PauseBehavior = 'silence'
    try {
      const patchRes = await fetch(base, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      })
      if (patchRes.ok) {
        toggled++
      } else {
        const e = (await patchRes.json().catch(() => ({}))) as { message?: string }
        lastErr = e.message
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : 'patch_failed'
    }
  }

  if (toggled === 0) return { ok: false, toggled: 0, error: lastErr || 'failed' }
  return { ok: true, toggled }
}
