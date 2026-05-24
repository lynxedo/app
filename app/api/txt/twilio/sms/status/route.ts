import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateTwilioSignature, twilioConfigured } from '@/lib/twilio'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

function twimlResponse(body = EMPTY_TWIML, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

// Twilio status callback values: queued, sending, sent, delivered, failed, undelivered.
// We collapse to: sending, sent, delivered, failed (undelivered → failed).
function normalizeStatus(raw: string): string {
  switch (raw) {
    case 'queued':
    case 'sending':
      return 'sending'
    case 'sent':
      return 'sent'
    case 'delivered':
      return 'delivered'
    case 'failed':
    case 'undelivered':
      return 'failed'
    default:
      return raw
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const params = Object.fromEntries(new URLSearchParams(rawBody))

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com'
  const signedUrl = `${baseUrl}${req.nextUrl.pathname}${req.nextUrl.search || ''}`

  if (twilioConfigured()) {
    const sigHeader = req.headers.get('x-twilio-signature')
    if (!validateTwilioSignature(signedUrl, params, sigHeader)) {
      console.warn('[txt:status] signature validation failed')
      return twimlResponse(EMPTY_TWIML, 403)
    }
  }

  const sid = params.MessageSid || params.SmsSid
  const rawStatus = params.MessageStatus || params.SmsStatus
  const errorMessage = params.ErrorMessage || params.ErrorCode

  if (!sid || !rawStatus) {
    return twimlResponse()
  }

  const supabase = createAdminClient()
  const update: { status: string; error_message?: string | null } = {
    status: normalizeStatus(rawStatus),
  }
  if (errorMessage) update.error_message = errorMessage

  const { data: row, error } = await supabase
    .from('txt_messages')
    .update(update)
    .eq('twilio_sid', sid)
    .select('id, conversation_id')
    .maybeSingle()

  if (error) {
    console.error('[txt:status] update failed', error)
  }

  // Broadcast for realtime UI
  if (row?.conversation_id) {
    try {
      const channel = supabase.channel(`txt:${HEROES_COMPANY_ID}`)
      await channel.subscribe()
      await channel.send({
        type: 'broadcast',
        event: 'status',
        payload: {
          conversation_id: row.conversation_id,
          sid,
          status: update.status,
        },
      })
      await supabase.removeChannel(channel)
    } catch (err) {
      console.warn('[txt:status] broadcast failed', err)
    }
  }

  return twimlResponse()
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'txt/twilio/sms/status',
    twilio_configured: twilioConfigured(),
  })
}
