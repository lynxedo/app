import { NextRequest, NextResponse } from 'next/server'
import { EMPTY_VOICE_TWIML, validateTwilioVoiceSignature, voiceConfigured } from '@/lib/twilio-voice'
import { redirectCall } from '@/lib/twilio-conference'
import { advanceRingGroup } from '@/lib/dialer-conference-connect'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendHubPush } from '@/lib/hub-push'
import { lookupByPhone } from '@/lib/dialer-lookup'

function xml(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/xml' } })
}

// Status callback for the AGENT participant Twilio dials into an inbound
// conference. When the agent doesn't pick up (no-answer / busy / failed /
// canceled), we redirect the still-waiting CALLER out of the conference into
// voicemail — reproducing the legacy <Dial action> no-answer → voicemail
// behavior in the conference model.
//
// caller_sid + owner ride in the query string (set when the agent participant
// is created). On a normal answer (in-progress → completed) we do nothing.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  const reqUrl = new URL(request.url)
  const signature = request.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}${reqUrl.pathname}${reqUrl.search}`
  if (voiceConfigured()) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return xml(EMPTY_VOICE_TWIML, 403)
    }
  }

  const callStatus = (params.get('CallStatus') || '').toLowerCase()
  const endedLegSid = params.get('CallSid') || ''
  const callerSid = reqUrl.searchParams.get('caller_sid') || ''
  const owner = reqUrl.searchParams.get('owner') || ''
  // Ring-group chain params (set by connectInboundToRingGroupViaConference).
  const room = reqUrl.searchParams.get('room') || ''
  const groupId = reqUrl.searchParams.get('group') || ''
  const mode = reqUrl.searchParams.get('mode') === 'sim' ? ('sim' as const) : ('seq' as const)
  const nextIndex = parseInt(reqUrl.searchParams.get('i') || '0', 10) || 0

  const unanswered = ['no-answer', 'busy', 'failed', 'canceled'].includes(callStatus)
  // Log every delivery — this callback is the no-answer→voicemail trigger, and
  // its registration silently broke once before (invalid StatusCallbackEvent
  // list, Twilio 21626). A no-answer test call should always show a line here.
  console.log(
    '[dialer.conference.agent-status]',
    'status', callStatus || '(none)',
    'unanswered', unanswered,
    'caller', callerSid ? 'present' : 'missing',
    groupId ? `group ${groupId} mode ${mode} i ${nextIndex}` : 'single-agent'
  )
  if (unanswered && callerSid) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    if (groupId && room) {
      // Group leg ended unanswered — ring the next member (sequential), or
      // check whether the whole group is exhausted (simultaneous) → voicemail.
      await advanceRingGroup({
        baseUrl,
        room,
        callerCallSid: callerSid,
        groupId,
        mode,
        nextIndex,
        endedLegSid: endedLegSid || undefined,
      }).catch(() => {})
    } else {
      const voicemailUrl = `${baseUrl}/api/dialer/voice/twiml/voicemail${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`
      // Best-effort — if the caller already hung up, the redirect just no-ops.
      await redirectCall({ callSid: callerSid, twimlUrl: voicemailUrl }).catch(() => {})

      // Stamp the calls row as 'no-answer' so scope=missed picks it up and the
      // orange dot appears on the Dialer rail icon. Also fire a push notification.
      // This must happen here (not in the voice/status route) because the caller's
      // leg ends as 'completed' when they hang up after the voicemail greeting —
      // that would clear the missed-call signal if we waited. We guard the
      // voice/status route from overwriting 'no-answer' with 'completed'.
      try {
        const admin = createAdminClient()
        const { data: callRow } = await admin
          .from('calls')
          .select('id, company_id, handled_by, from_number')
          .eq('twilio_call_sid', callerSid)
          .maybeSingle()
        if (callRow) {
          await admin.from('calls').update({ status: 'no-answer' }).eq('id', callRow.id)
          if (callRow.handled_by) {
            const raw = callRow.from_number || ''
            const digits = raw.replace(/\D/g, '')
            let formatted = raw
            if (digits.length === 11 && digits[0] === '1') {
              formatted = `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`
            } else if (digits.length === 10) {
              formatted = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`
            }
            // Resolve the caller's name (Jobber client / txt contact) so the push
            // reads "Jane Doe" instead of a bare phone number. Best-effort.
            let callerName: string | null = null
            if (raw) {
              try {
                const match = await lookupByPhone(raw, callRow.company_id)
                callerName = match?.name || null
              } catch { /* fall back to the number */ }
            }
            const body = callerName
              ? (formatted ? `${callerName} · ${formatted}` : callerName)
              : (formatted || 'Unknown number')
            await sendHubPush(
              [callRow.handled_by],
              {
                title: '📞 Missed call',
                body,
                url: '/hub/dialer',
                type: 'missed_call',
                groupKey: `missed_call_${callRow.id}`,
              }
            ).catch(() => {})
          }
        }
      } catch (e) {
        console.warn('[dialer.conference.agent-status] no-answer stamp/push failed', e)
      }
    }
  }

  return xml(EMPTY_VOICE_TWIML)
}

export async function GET() {
  return NextResponse.json({ ok: true, route: 'dialer.voice.conference.agent-status' })
}
