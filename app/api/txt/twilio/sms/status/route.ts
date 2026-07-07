import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateTwilioSignature, twilioConfigured, sendSms } from '@/lib/twilio'
import { twilioMediaUrls } from '@/lib/txt-media-sign'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// When set, an outbound that a carrier rejects with 30003 ("unreachable" — the
// signature of AT&T blocking our long code) is automatically resent from this
// toll-free line (which still reaches AT&T) and its conversation is pinned to
// it. Empty = no reroute (behaves exactly as before).
const FALLBACK_NUMBER = process.env.TWILIO_FALLBACK_NUMBER || ''

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
    .select('id, conversation_id, direction, body, media_urls, contact_id, phone_number_id, rerouted')
    .maybeSingle()

  if (error) {
    console.error('[txt:status] update failed', error)
  }

  let finalStatus = update.status

  // Reactive fallback: a 30003 "unreachable" on an outbound from our A2P long
  // code is the signature of AT&T blocking the number. Auto-resend via the
  // toll-free line (which reaches AT&T), pin the conversation to it (so the
  // thread stays on one number), and flag the message as rerouted. Self-
  // disabling — once AT&T clears the block, sends succeed and this never fires.
  // Guarded: 30003 only, outbound, not already rerouted, never to a do-not-text
  // contact, and not if the original already went out on the fallback line.
  if (
    row &&
    FALLBACK_NUMBER &&
    twilioConfigured() &&
    finalStatus === 'failed' &&
    params.ErrorCode === '30003' &&
    row.direction === 'outbound' &&
    !row.rerouted
  ) {
    try {
      const { data: fb } = await supabase
        .from('txt_phone_numbers')
        .select('id')
        .eq('company_id', HEROES_COMPANY_ID)
        .eq('twilio_number', FALLBACK_NUMBER)
        .maybeSingle()
      const fallbackId = fb?.id ?? null
      const alreadyOnFallback = !!fallbackId && row.phone_number_id === fallbackId

      let contact: { phone: string | null; do_not_text: boolean } | null = null
      if (row.contact_id) {
        const r = await supabase
          .from('txt_contacts')
          .select('phone, do_not_text')
          .eq('id', row.contact_id)
          .maybeSingle()
        contact = (r.data as { phone: string | null; do_not_text: boolean } | null) ?? null
      }

      if (contact?.phone && !contact.do_not_text && !alreadyOnFallback) {
        // Make sure the customer can tell who this is when it arrives from a new
        // number: append the company name if the body doesn't already include it.
        let body: string = row.body || ''
        const { data: company } = await supabase
          .from('companies')
          .select('name')
          .eq('id', HEROES_COMPANY_ID)
          .maybeSingle()
        const companyName = company?.name || ''
        if (companyName && body && !body.toLowerCase().includes(companyName.toLowerCase())) {
          body = `${body}\n\n- ${companyName}`
        }

        const mediaUrls: string[] = Array.isArray(row.media_urls) ? row.media_urls : []
        // Direct R2 presigned URL for Twilio (bypasses Cloudflare's block on
        // our domain → error 11200); see lib/txt-media-sign.ts.
        const publicMediaUrls = await twilioMediaUrls(mediaUrls)

        const resend = await sendSms({
          to: contact.phone,
          body,
          mediaUrls: publicMediaUrls.length ? publicMediaUrls : undefined,
          statusCallback: `${baseUrl}/api/txt/twilio/sms/status`,
          fromNumber: FALLBACK_NUMBER,
        })

        if (resend.ok) {
          await supabase
            .from('txt_messages')
            .update({
              twilio_sid: resend.sid,
              status: resend.status === 'delivered' ? 'delivered' : 'sent',
              error_message: null,
              phone_number_id: fallbackId,
              rerouted: true,
              body,
            })
            .eq('id', row.id)
          finalStatus = 'sent'
          if (row.conversation_id && fallbackId) {
            await supabase
              .from('txt_conversations')
              .update({ phone_number_id: fallbackId })
              .eq('id', row.conversation_id)
          }
        }
      }
    } catch (err) {
      console.error('[txt:status] reroute failed', err)
    }
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
          status: finalStatus,
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
