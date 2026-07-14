import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendHubPush } from '@/lib/hub-push'
import { fanoutGuardianNotification } from '@/lib/guardian-post'
import { sendSms, toE164 } from '@/lib/twilio'
import {
  ensureInboundQueueConversation,
  findOrCreateContactByPhone,
} from '@/lib/txt-inbound-queue'
import { formatPhone } from '@/lib/format'

export const dynamic = 'force-dynamic'

// POST /api/voice/fallback-notify
//
// Called by the Twilio-hosted emergency fallback Function (service
// lynxedo-voice-fallback) after it records a voicemail. The fallback only
// runs when the PRIMARY voice flow threw a fatal error mid-call, so every
// request here doubles as a production incident signal.
//
// Delivery is per Admin → Dialer "Fallback voicemail alerts":
//   fallback_notify_method    'hub' (Guardian DM + push, default) | 'sms' | 'both'
//   fallback_notify_user_ids  hub recipients; empty → voicemail_recipient_user_ids
//   fallback_notify_sms_numbers  E164 targets when method includes sms
//
// The Function keeps its own break-glass SMS for when this endpoint is
// unreachable (a full-platform outage) — a non-2xx here triggers it, so this
// route returns 500 on total delivery failure rather than swallowing it.
//
// Auth: same Bearer VOICE_SERVICE_SECRET as /api/voice/brain + /api/voice/lookup.

const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

function bearerAuthorized(request: Request): boolean {
  const secret = process.env.VOICE_SERVICE_SECRET || ''
  if (!secret) return false
  const header = request.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return false
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  if (!bearerAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    from?: string
    to?: string
    callSid?: string
    recordingUrl?: string
    errorCode?: string
    errorUrl?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const recordingUrl = typeof body.recordingUrl === 'string' ? body.recordingUrl : ''
  if (!recordingUrl.startsWith('https://api.twilio.com/')) {
    return NextResponse.json({ error: 'recordingUrl required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const fromNumber = typeof body.from === 'string' ? body.from : ''
  const caller = formatPhone(fromNumber) || fromNumber || 'Unknown caller'
  const when = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  const { data: settings } = await admin
    .from('dialer_settings')
    .select('fallback_notify_method, fallback_notify_user_ids, fallback_notify_sms_numbers, voicemail_recipient_user_ids')
    .eq('company_id', HEROES_COMPANY_ID)
    .maybeSingle()

  const method = settings?.fallback_notify_method === 'sms' || settings?.fallback_notify_method === 'both'
    ? settings.fallback_notify_method
    : 'hub'
  const hubUserIds: string[] =
    (settings?.fallback_notify_user_ids?.length
      ? settings.fallback_notify_user_ids
      : settings?.voicemail_recipient_user_ids) ?? []

  const message =
    `🛟 EMERGENCY fallback voicemail — the phone system errored on a live call and the Twilio-hosted backup answered.\n` +
    `Caller: ${caller} at ${when} (Central)\n` +
    `Listen: ${recordingUrl}.mp3\n` +
    (body.errorCode ? `Twilio error ${body.errorCode}${body.errorUrl ? ` on ${body.errorUrl}` : ''}\n` : '') +
    `The main call flow failed on this call — worth investigating.`

  let dmsSent = 0
  let smsSent = 0

  if (method !== 'sms' && hubUserIds.length > 0) {
    const res = await fanoutGuardianNotification({
      companyId: HEROES_COMPANY_ID,
      userIds: hubUserIds,
      roomIds: [],
      body: message,
      admin,
    })
    dmsSent = res.dmsSent
    sendHubPush(hubUserIds, {
      title: `🛟 Fallback voicemail — ${caller}`,
      body: 'Phone system errored on a live call; the backup took a message.',
      url: '/hub/home',
      type: 'voicemail',
    }, { isDm: true }).catch((err) => {
      console.warn('[fallback-notify] push fan-out failed', err)
    })
  }

  if (method !== 'hub') {
    const targets = (settings?.fallback_notify_sms_numbers ?? [])
      .map((n: string) => toE164(n))
      .filter((n: string | null): n is string => Boolean(n))
    for (const to of targets) {
      const res = await sendSms({ to, body: message })
      if (res.ok) smsSent++
    }
  }

  // Surface it in the unified Queue like a normal voicemail so the office can
  // triage it in the usual workflow. Best-effort — never fails the notify.
  try {
    if (fromNumber) {
      const contactId = await findOrCreateContactByPhone(admin, HEROES_COMPANY_ID, fromNumber)
      if (contactId) {
        await ensureInboundQueueConversation(admin, {
          companyId: HEROES_COMPANY_ID,
          contactId,
          preview: '🛟 Emergency fallback voicemail',
        })
      }
    }
  } catch (e) {
    console.warn('[fallback-notify] queue ensure failed', e)
  }

  // Nothing delivered → tell the Function so its break-glass SMS fires.
  if (dmsSent === 0 && smsSent === 0) {
    return NextResponse.json({ ok: false, error: 'no_delivery' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, dmsSent, smsSent })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: Boolean(process.env.VOICE_SERVICE_SECRET),
    route: 'voice.fallback-notify',
  })
}
