import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const HEROES_COMPANY_ID = process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

const API = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}`

type Rec = { sid: string; status: string; call_sid?: string | null; conference_sid?: string | null }

// POST /api/dialer/voice/recording/pause
// Pause or resume the recording(s) on the user's active call.
// Body: { action: 'pause' | 'resume' }
//
// An active Dialer call can be recorded in TWO places at once:
//   1. the CONFERENCE (record="record-from-start" on <Conference>), and
//   2. a call leg (the inbound startCallRecording REST path).
// So we gather every in-progress/paused recording across the conference AND the
// call leg and toggle them all — addressing each by its own SIDs — so pause
// works regardless of which recording is actually capturing audio.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_dialer, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_dialer) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: { action?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const action = body.action === 'resume' ? 'resume' : 'pause'

  const admin = createAdminClient()

  // Find the user's active call (not yet ended). NB: we key on ended_at only —
  // inbound conference calls don't reliably stamp answered_at, so requiring it
  // made pause/resume 404 on every inbound call.
  const { data: activeCall } = await admin
    .from('calls')
    .select('id, twilio_call_sid, conference_sid, conference_name, recording_paused')
    .eq('company_id', profile.company_id || HEROES_COMPANY_ID)
    .is('ended_at', null)
    .or(`handled_by.eq.${user.id},initiated_by.eq.${user.id}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!activeCall) {
    console.warn('[dialer.recording.pause] no active call for user', user.id)
    return NextResponse.json({ error: 'No active call found' }, { status: 404 })
  }

  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    return NextResponse.json({ error: 'Twilio not configured' }, { status: 501 })
  }

  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')
  const headers = { Authorization: `Basic ${auth}` }

  // Resolve the live conference SID: the stored one, or look it up by name (it's
  // stamped slightly after the row is created, so it can be briefly null).
  let conferenceSid: string | null = activeCall.conference_sid ?? null
  if (!conferenceSid && activeCall.conference_name) {
    try {
      const r = await fetch(
        `${API}/Conferences.json?FriendlyName=${encodeURIComponent(activeCall.conference_name)}&Status=in-progress`,
        { headers }
      )
      if (r.ok) {
        const d = (await r.json()) as { conferences?: { sid: string }[] }
        conferenceSid = d.conferences?.[0]?.sid ?? null
      }
    } catch { /* fall through */ }
  }

  // Gather candidate recordings from BOTH the conference and the call leg.
  const listUrls: string[] = []
  if (conferenceSid) listUrls.push(`${API}/Conferences/${encodeURIComponent(conferenceSid)}/Recordings.json`)
  if (activeCall.twilio_call_sid) listUrls.push(`${API}/Calls/${encodeURIComponent(activeCall.twilio_call_sid)}/Recordings.json`)

  const seen = new Set<string>()
  const recordings: Rec[] = []
  for (const url of listUrls) {
    try {
      const res = await fetch(url, { headers })
      if (!res.ok) continue
      const data = (await res.json()) as { recordings?: Rec[] }
      for (const rec of data.recordings ?? []) {
        if (rec.sid && !seen.has(rec.sid)) { seen.add(rec.sid); recordings.push(rec) }
      }
    } catch { /* skip this source */ }
  }

  // ⚠ The Recordings LIST is not a reliable source of live pause-state: an
  // actively-recording recording lists as 'processing' (its initial status),
  // and a PAUSED recording ALSO lists as 'processing' (both verified live in
  // prod — filtering resume targets to status 'paused' matched nothing, which
  // is why Resume 404'd while Pause worked). So don't infer state from the
  // list at all: target every non-terminal recording and PATCH it to the
  // desired status. A same-state PATCH is a harmless no-op, per-recording
  // failures are tolerated as long as one toggles, and a recording that also
  // reads 'processing' because the call already ended just fails its PATCH.
  const targets = recordings.filter(
    r => r.status === 'processing' || r.status === 'in-progress' || r.status === 'paused'
  )
  console.log(
    '[dialer.recording.pause]', action,
    'call', activeCall.id,
    'confSid', conferenceSid,
    'callSid', activeCall.twilio_call_sid,
    'recs', recordings.map(r => `${r.sid}:${r.status}`).join(',') || 'none',
    'targets', targets.length
  )
  if (targets.length === 0) {
    return NextResponse.json({ error: 'No active recording on this call' }, { status: 404 })
  }

  const newStatus = action === 'pause' ? 'paused' : 'in-progress'
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
    if (action === 'pause') form.PauseBehavior = 'silence'
    try {
      const patchRes = await fetch(base, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      })
      if (patchRes.ok) {
        toggled++
      } else {
        const errBody = await patchRes.json().catch(() => ({})) as { message?: string }
        lastErr = errBody.message
        console.warn('[dialer.recording.pause] PATCH failed', rec.sid, errBody.message)
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : 'patch_failed'
    }
  }

  if (toggled === 0) {
    return NextResponse.json({ error: lastErr || 'Failed to update recording' }, { status: 502 })
  }

  // Mirror state into our DB.
  await admin
    .from('calls')
    .update({ recording_paused: action === 'pause' })
    .eq('id', activeCall.id)

  return NextResponse.json({ ok: true, paused: action === 'pause', toggled })
}
