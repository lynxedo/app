import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const HEROES_COMPANY_ID = process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// POST /api/dialer/voice/recording/pause
// Pause or resume the recording on the user's active call.
// Body: { action: 'pause' | 'resume' }
// Finds the user's active call in the DB, lists its Twilio recordings, and
// pauses/resumes the first one. Updates calls.recording_paused.
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

  // Find the user's active call (answered but not yet ended).
  const { data: activeCall } = await admin
    .from('calls')
    .select('id, twilio_call_sid, conference_sid, recording_paused')
    .eq('company_id', profile.company_id || HEROES_COMPANY_ID)
    .not('answered_at', 'is', null)
    .is('ended_at', null)
    .or(`handled_by.eq.${user.id},initiated_by.eq.${user.id}`)
    .order('answered_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!activeCall?.twilio_call_sid) {
    return NextResponse.json({ error: 'No active call found' }, { status: 404 })
  }

  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    return NextResponse.json({ error: 'Twilio not configured' }, { status: 501 })
  }

  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')

  // Phase-3 conference calls record on the CONFERENCE (record="record-from-start"
  // on <Conference>), NOT on the agent's call leg — so the recording lives under
  // /Conferences/{sid}/Recordings, and the old /Calls/{sid}/Recordings lookup
  // always came back empty (404 "No active recording"). Prefer the conference
  // resource when this is a conference call; fall back to the call leg for legacy
  // point-to-point <Dial> recordings.
  const recBase = activeCall.conference_sid
    ? `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Conferences/${encodeURIComponent(activeCall.conference_sid)}/Recordings`
    : `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Calls/${encodeURIComponent(activeCall.twilio_call_sid)}/Recordings`

  // List recordings for this call/conference to find the active RecordingSid.
  const listRes = await fetch(`${recBase}.json`, { headers: { Authorization: `Basic ${auth}` } })
  if (!listRes.ok) {
    return NextResponse.json({ error: 'Failed to list recordings' }, { status: 502 })
  }
  const listData = (await listRes.json()) as { recordings?: { sid: string; status: string }[] }
  const recordings = listData.recordings ?? []
  // Find the in-progress (or paused) recording to toggle.
  const target = recordings.find(r => r.status === 'in-progress' || r.status === 'paused')
  if (!target) {
    return NextResponse.json({ error: 'No active recording on this call' }, { status: 404 })
  }

  // Pause or resume — Twilio's status values for recording: 'paused' | 'in-progress'
  const newStatus = action === 'pause' ? 'paused' : 'in-progress'
  const patchRes = await fetch(
    `${recBase}/${encodeURIComponent(target.sid)}.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ Status: newStatus, PauseBehavior: 'silence' }).toString(),
    }
  )
  if (!patchRes.ok) {
    const errBody = await patchRes.json().catch(() => ({})) as { message?: string }
    console.warn('[dialer.recording.pause] Twilio PATCH failed:', errBody.message)
    return NextResponse.json({ error: errBody.message || 'Failed to update recording' }, { status: 502 })
  }

  // Mirror state into our DB.
  await admin
    .from('calls')
    .update({ recording_paused: action === 'pause' })
    .eq('id', activeCall.id)

  return NextResponse.json({ ok: true, paused: action === 'pause' })
}
