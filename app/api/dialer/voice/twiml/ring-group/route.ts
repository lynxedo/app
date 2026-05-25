import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  EMPTY_VOICE_TWIML,
  isInDndSchedule,
  twimlRingGroupSequentialStep,
  twimlRingGroupSimultaneous,
  validateTwilioVoiceSignature,
  voiceConfigured,
  type DndSchedule,
} from '@/lib/twilio-voice'

const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

function twimlResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

// Session 60 ring-group TwiML handler.
//
// Two patterns share this single route:
//
// (A) Simultaneous mode — entered with i=0. We fetch the group + members,
//     filter out anyone who is DND-now, render one <Dial> with multiple
//     <Client> children, action= points at /voice/twiml/voicemail so any
//     unanswered call falls through to general voicemail.
//
// (B) Sequential mode — entered with i=0 dialing member[0]. If they don't
//     answer (DialCallStatus != answered/completed), Twilio POSTs back here
//     with i=1, we dial member[1], etc. Once i >= members.length, fall
//     through to general voicemail.
//
// Either way we skip DND-now members. Empty member list (whole group is DND
// or never had members) falls through to general voicemail.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  const url = new URL(request.url)
  const groupId = url.searchParams.get('group') || ''
  const index = parseInt(url.searchParams.get('i') || '0', 10) || 0

  const signature = request.headers.get('x-twilio-signature')
  const validateUrl = `${process.env.NEXT_PUBLIC_APP_URL}${url.pathname}${url.search}`
  if (voiceConfigured() && signature) {
    if (!validateTwilioVoiceSignature(validateUrl, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  const fromNumber = params.get('From') || undefined
  const dialStatus = (params.get('DialCallStatus') || '').toLowerCase()
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const voicemailRouteUrl = `${baseUrl}/api/dialer/voice/twiml/voicemail`

  // If we're being re-entered after a dial completed/answered, we're done.
  // (Twilio sometimes posts the action callback even when the inner call was
  // answered — this empty TwiML just lets the legged call end cleanly.)
  if (dialStatus === 'answered' || dialStatus === 'completed') {
    return twimlResponse(EMPTY_VOICE_TWIML)
  }

  if (!groupId) {
    return twimlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${voicemailRouteUrl}</Redirect></Response>`
    )
  }

  const admin = createAdminClient()

  // Resolve the group + members + each member's DND state. Two queries because
  // the join across user_profiles + hub_users + dialer_ring_group_members has
  // no clean PostgREST embed path.
  const { data: group } = await admin
    .from('dialer_ring_groups')
    .select('id, company_id, name, ring_mode, ring_timeout_sec')
    .eq('id', groupId)
    .maybeSingle()

  if (!group) {
    return twimlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${voicemailRouteUrl}</Redirect></Response>`
    )
  }

  const { data: memberRows } = await admin
    .from('dialer_ring_group_members')
    .select('user_id, position, member_timeout_sec')
    .eq('group_id', groupId)
    .order('position')

  const members = memberRows ?? []
  if (members.length === 0) {
    return twimlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${voicemailRouteUrl}</Redirect></Response>`
    )
  }

  // Filter DND-now members. user_profiles.id == hub_users.id == identity.
  const userIds = members.map((m) => m.user_id)
  const { data: profileRows } = await admin
    .from('user_profiles')
    .select('id, dialer_dnd_enabled, dialer_dnd_schedule')
    .in('id', userIds)
  const dndById = new Map<string, boolean>()
  for (const p of profileRows ?? []) {
    const sched = (p.dialer_dnd_schedule || null) as DndSchedule | null
    const isDnd = Boolean(p.dialer_dnd_enabled) || isInDndSchedule(sched)
    dndById.set(p.id, isDnd)
  }

  const available = members.filter((m) => !dndById.get(m.user_id))
  if (available.length === 0) {
    // Everyone in the group is DND right now — fall through to general voicemail.
    return twimlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${voicemailRouteUrl}</Redirect></Response>`
    )
  }

  if (group.ring_mode === 'simultaneous') {
    const identities = available.map((m) => m.user_id)
    return twimlResponse(
      twimlRingGroupSimultaneous({
        identities,
        callerId: fromNumber,
        timeoutSec: group.ring_timeout_sec ?? 25,
        actionUrl: voicemailRouteUrl,
      })
    )
  }

  // Sequential: dial available[index]. If out of bounds, fall through.
  if (index >= available.length) {
    return twimlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${voicemailRouteUrl}</Redirect></Response>`
    )
  }
  const current = available[index]
  const nextStepUrl = `${baseUrl}/api/dialer/voice/twiml/ring-group?group=${encodeURIComponent(groupId)}&i=${index + 1}`
  return twimlResponse(
    twimlRingGroupSequentialStep({
      identity: current.user_id,
      callerId: fromNumber,
      timeoutSec: current.member_timeout_sec ?? 20,
      nextStepUrl,
    })
  )
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    twilio_configured: voiceConfigured(),
    route: 'dialer.voice.twiml.ring-group',
  })
}
