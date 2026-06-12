import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isInBusinessHours, sendResponderText, type ResponderMode } from '@/lib/responder'

const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// How long after a call ends we wait before texting, so the voicemail webhook
// (/voice/voicemail/complete) has time to insert the voicemails row — that's
// what lets us pick the "left a message" vs "no message" template correctly.
const SETTLE_SECONDS = 20

// When AI reply is on, the generic template is ONLY sent for genuine hangups
// (no voicemail) — voicemail callers get the single personalized reply from the
// transcription pipeline instead. Deciding "no voicemail" too early double-texts
// the caller: in forwarded-line mode a call can report an early ended_at while
// the caller is still recording, so the 20s window fired the "no message" text
// ~20s BEFORE Twilio saved the voicemail, then the AI reply went out too. Wait
// much longer here so the voicemails row has definitely landed before we ever
// conclude a call was a pure hangup. (Harmless for voicemail calls — the AI path
// is independent and already replied; this only delays the rare hangup text.)
const AI_SETTLE_SECONDS = 120

// Cron-driven responder auto-text. Wire on the VPS:
//   */1 * * * * curl -s -X POST https://staging.lynxedo.com/api/dialer/responder/reconcile \
//     -H "x-cron-secret: $CRON_SECRET"
//
// This is the SINGLE send point for the responder. Every inbound call that ran
// under an active responder mode is stamped calls.responder_mode at pickup; once
// it ends we text the caller exactly once (atomic claim on responder_text_status
// prevents double-texting across overlapping cron runs). It is also the natural
// home for a future Guardian AI step that reads the voicemail transcript and
// crafts a custom reply instead of a static template.
export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Load responder config (mode + templates + business hours). If off, no-op.
  const { data: settings } = await admin
    .from('responder_settings')
    .select(
      'mode, ai_reply_enabled, business_days, business_hours_start, business_hours_end, business_hours_template, business_hours_no_message_template, afterhours_template, afterhours_no_message_template'
    )
    .eq('company_id', HEROES_COMPANY_ID)
    .maybeSingle()

  const mode = (settings?.mode as ResponderMode | undefined) ?? 'off'
  const aiReplyEnabled = !!settings?.ai_reply_enabled
  if (!settings || mode === 'off') {
    return NextResponse.json({ processed: 0, reason: 'responder_off' })
  }

  const settleSeconds = aiReplyEnabled ? AI_SETTLE_SECONDS : SETTLE_SECONDS
  const cutoff = new Date(Date.now() - settleSeconds * 1000).toISOString()

  // Calls that ran under the responder, have ended, settled long enough for the
  // voicemail webhook to land, and haven't been texted yet.
  const { data: pending, error } = await admin
    .from('calls')
    .select('id, twilio_call_sid, from_number, to_number, status, responder_mode, ended_at, answered_at')
    .eq('company_id', HEROES_COMPANY_ID)
    .eq('direction', 'inbound')
    .not('responder_mode', 'is', null)
    .is('responder_text_status', null)
    .not('ended_at', 'is', null)
    .lt('ended_at', cutoff)
    .order('ended_at', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!pending || pending.length === 0) return NextResponse.json({ processed: 0 })

  const inBiz = isInBusinessHours(settings)
  const templates = {
    business_hours_template: settings.business_hours_template,
    business_hours_no_message_template: settings.business_hours_no_message_template,
    afterhours_template: settings.afterhours_template,
    afterhours_no_message_template: settings.afterhours_no_message_template,
  }

  let texted = 0
  let skipped = 0

  for (const call of pending) {
    // Atomic claim — only one cron run wins the null -> processing transition.
    const { data: claimed } = await admin
      .from('calls')
      .update({ responder_text_status: 'processing' })
      .eq('id', call.id)
      .is('responder_text_status', null)
      .select('id')
      .maybeSingle()
    if (!claimed) continue

    try {
      // For forwarded_line with ringing enabled: if answered_at is set, a human
      // actually picked up — skip the auto-text (no need to text back someone
      // who was already helped). The normal straight-to-voicemail path never
      // sets answered_at, so this guard is a no-op when ring=0.
      if (call.responder_mode === 'forwarded_line' && call.answered_at != null) {
        await admin.from('calls').update({ responder_text_status: 'skipped' }).eq('id', call.id)
        await logResponderCall(admin, call, { hadVoicemail: false, textSent: false, templateUsed: null, error: 'answered' })
        skipped++
        continue
      }

      // Did they leave a voicemail? Drives the template choice.
      const { data: vmRow } = await admin
        .from('voicemails')
        .select('id')
        .eq('call_id', call.id)
        .limit(1)
        .maybeSingle()
      const hadVoicemail = !!vmRow

      // AI reply on + a voicemail was left → suppress the generic template here.
      // The AI path (triggerAutoReply in voicemail-transcribe, after the
      // transcript is ready) sends the only message — a personalized reply, or
      // the standard template as a fallback if the voicemail had no transcript.
      // (No-voicemail / hangup calls fall through to the normal template below.)
      if (aiReplyEnabled && hadVoicemail) {
        await admin.from('calls').update({ responder_text_status: 'skipped' }).eq('id', call.id)
        await logResponderCall(admin, call, { hadVoicemail, textSent: false, templateUsed: 'ai_reply', error: null })
        skipped++
        continue
      }

      // Main Line mode: the call rings the team and CAN be answered. If no
      // voicemail was left and the call wasn't a clear no-answer, assume a human
      // picked up → don't text. (Forwarded Line never rings anyone, so a missing
      // voicemail there always means "hung up during greeting" → no-message text.)
      // The exact answered-vs-not detection for Main Line should be re-validated
      // once the local number is ported and main-line routing is finalized.
      let skipReason: string | null = null
      if (!hadVoicemail && call.responder_mode === 'main_line') {
        const noAnswer = ['no-answer', 'busy', 'failed', 'canceled'].includes(call.status || '')
        if (!noAnswer) skipReason = 'answered'
      }

      if (skipReason) {
        await admin.from('calls').update({ responder_text_status: 'skipped' }).eq('id', call.id)
        await logResponderCall(admin, call, { hadVoicemail, textSent: false, templateUsed: null, error: skipReason })
        skipped++
        continue
      }

      const result = await sendResponderText(admin, {
        companyId: HEROES_COMPANY_ID,
        fromNumber: call.from_number || '',
        ourNumber: call.to_number || null,
        inBusinessHours: inBiz,
        hadVoicemail,
        templates,
      })

      await admin
        .from('calls')
        .update({ responder_text_status: result.error === 'do_not_text' ? 'skipped' : 'sent' })
        .eq('id', call.id)
      await logResponderCall(admin, call, {
        hadVoicemail,
        textSent: result.textSent,
        templateUsed: result.templateUsed,
        error: result.error,
      })
      if (result.textSent) texted++
      else skipped++
    } catch (e) {
      // Release the claim so a later run can retry.
      await admin.from('calls').update({ responder_text_status: null }).eq('id', call.id)
      console.warn('[responder.reconcile] call failed', call.id, e)
    }
  }

  return NextResponse.json({ processed: pending.length, texted, skipped })
}

async function logResponderCall(
  admin: ReturnType<typeof createAdminClient>,
  call: { twilio_call_sid: string | null; from_number: string | null; ended_at: string | null },
  outcome: { hadVoicemail: boolean; textSent: boolean; templateUsed: string | null; error: string | null }
) {
  try {
    await admin.from('responder_calls').insert({
      company_id: HEROES_COMPANY_ID,
      call_sid: call.twilio_call_sid,
      from_number: call.from_number,
      called_at: call.ended_at || new Date().toISOString(),
      has_voicemail: outcome.hadVoicemail,
      text_sent: outcome.textSent,
      email_sent: false,
      template_used: outcome.templateUsed,
      error_message: outcome.error,
    })
  } catch {
    // best-effort logging
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, route: 'dialer.responder.reconcile' })
}
