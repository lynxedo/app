import { NextResponse, after } from 'next/server'
import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import { syncLeadToDirectory } from '@/lib/contacts-directory'
import {
  ensureInboundQueueConversation,
  findOrCreateContactByPhone,
} from '@/lib/txt-inbound-queue'
import { fanoutGuardianNotification } from '@/lib/guardian-post'
import { postOfficeAlert } from '@/lib/office-alerts'
import { sendHubPush } from '@/lib/hub-push'
import { formatPhone } from '@/lib/format'
import { toE164 } from '@/lib/phone'
import { sendDirectTxtToPhone } from '@/lib/txt-send'
import { getEffectiveVoiceReceptionistSettings } from '@/lib/voice-receptionist-settings'
import { getBusinessProfile } from '@/lib/business-profile'
import { getAiTextBotUserId } from '@/lib/ai-text-identity'

// AI Voice Receptionist — "wrap-up" endpoint (Phase 1a).
//
// The ConversationRelay WS service POSTs here once the after-hours call ends,
// with the full transcript. We:
//   1. Extract a structured lead from the transcript (one non-streaming Claude call).
//   2. Insert a `leads` row (lead_source='AI Receptionist') + a `lead_notes` row
//      carrying the summary + full transcript, and mirror to the contacts directory.
//   3. Surface the caller in the Hub Queue like any inbound (find-or-create
//      contact + unassigned conversation).
//   4. Notify the office with a single post in the Hub "office" room so it's
//      worked ASAP (no Guardian DM / push — the room post is the one surface).
//
// Steps 3–4 are best-effort side effects (via after()) — a failure there must
// never fail the wrap-up. Auth: Authorization: Bearer <VOICE_SERVICE_SECRET>.

export const runtime = 'nodejs'

const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'
// Ben's Hub user id (matches the feedback route's notify default). The alerts
// room is no longer pinned here — lib/office-alerts.ts resolves it per company.
const DEFAULT_NOTIFY_USER_ID = '6939b706-5135-448d-a28a-7674ba17974e' // Ben

function notifyUserIds(): string[] {
  const raw = process.env.VOICE_NOTIFY_USER_IDS
  if (raw && raw.trim()) {
    const ids = raw.split(',').map((s) => s.trim()).filter(Boolean)
    if (ids.length) return ids
  }
  return [DEFAULT_NOTIFY_USER_ID]
}

function bearerAuthorized(request: Request): boolean {
  const secret = process.env.VOICE_SERVICE_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return false
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

type TranscriptTurn = { role?: string; text?: string }

type WrapupBody = {
  companyId?: string
  callSid?: string
  from?: string
  to?: string
  startedAt?: string
  endedAt?: string
  transcript?: TranscriptTurn[]
}

// What KIND of call this was — drives wrap-up routing (PRD §18). Sales leads go
// to the Lead Tracker; everything else is routed to the office to work (no new
// lead). When unsure the classifier returns 'sales_lead' so a potential lead is
// never lost.
type CallType = 'sales_lead' | 'complaint' | 'scheduling' | 'billing' | 'existing_customer' | 'other'

type ExtractedLead = {
  name: string | null
  callback_phone: string | null
  address_or_area: string | null
  service_wanted: string | null
  timeframe: string | null
  urgency: 'low' | 'normal' | 'high' | 'emergency'
  summary: string | null
  wants_callback: boolean
  /** Level 3 soft sell: caller explicitly agreed to move forward / get set up. */
  soft_commitment: boolean
  /** Caller agreed to receive a recap text (SMS opt-in captured live on the call). */
  recap_opt_in: boolean
  /** Why they called — routes the wrap-up (sales lead vs service/complaint/billing). */
  call_type: CallType
}

const URGENCY_VALUES: ExtractedLead['urgency'][] = ['low', 'normal', 'high', 'emergency']
const CALL_TYPE_VALUES: CallType[] = ['sales_lead', 'complaint', 'scheduling', 'billing', 'existing_customer', 'other']

// Framing for a non-sales (service) call in the office notification + queue.
const SERVICE_CALL_META: Record<Exclude<CallType, 'sales_lead'>, { emoji: string; label: string }> = {
  complaint: { emoji: '⚠️', label: 'Complaint' },
  scheduling: { emoji: '📅', label: 'Scheduling request' },
  billing: { emoji: '💳', label: 'Billing question' },
  existing_customer: { emoji: '📇', label: 'Customer service call' },
  other: { emoji: '☎️', label: 'Call for the office' },
}

function renderTranscript(turns: TranscriptTurn[]): string {
  return turns
    .map((t) => {
      const who = (t.role || '').toLowerCase()
      const label =
        who === 'assistant' || who === 'bot' || who === 'ai'
          ? 'Assistant'
          : who === 'user' || who === 'caller' || who === 'human'
            ? 'Caller'
            : t.role || 'Speaker'
      return `${label}: ${(t.text || '').trim()}`
    })
    .filter((l) => l.trim().length > 0)
    .join('\n')
}

// A phone number we can actually dial, or null.
//
// Amber deliberately reads a callback number back by its LAST FOUR digits only
// (so the TTS never mangles a full number — see buildCallContextNote in
// lib/voice-receptionist.ts), which means the transcript usually contains only a
// masked reference to it: "your number ending in one one eight five". The
// extractor happily returned that as `callback_phone`, and a truthy partial WON
// over the real caller ID — so the Lead Tracker filled up with undialable junk
// ("ending in 1185", "xxxx-xx-9201") and, because the directory sync needs ten
// digits, those leads never mirrored into Contacts either.
//
// Anything that isn't a complete number is discarded here so the caller ID (ANI)
// wins instead. A caller who gives a DIFFERENT full number still keeps it — they
// speak it in full, so the extractor has real digits to return.
function dialablePhoneOrNull(raw: string | null | undefined): string | null {
  if (!raw) return null
  return toE164(String(raw))
}

function splitName(full: string | null): { first: string | null; last: string | null } {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { first: null, last: null }
  if (parts.length === 1) return { first: parts[0], last: null }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

// The extracted service phrase (e.g. "Broken irrigation/sprinkler pipe repair")
// is a label — it reads as a mid-sentence proper noun when dropped into prose
// ("…your call about Broken irrigation…"). Lower-case the first letter so it
// flows, but leave a leading acronym alone (e.g. "AC unit repair").
function lowerFirstForSentence(s: string): string {
  const t = (s || '').trim()
  if (!t) return t
  const firstWord = t.split(/\s+/)[0]
  if (firstWord.length > 1 && firstWord === firstWord.toUpperCase()) return t
  return t.charAt(0).toLowerCase() + t.slice(1)
}

// Extract a structured lead from the transcript. One non-streaming Claude call,
// strict "reply with ONLY JSON". Never throws — returns null so the caller can
// fall back to a minimal lead built from the raw transcript.
async function extractLead(
  transcriptText: string,
  fallbackPhone: string | null
): Promise<ExtractedLead | null> {
  if (!process.env.ANTHROPIC_API_KEY || !transcriptText.trim()) return null
  const system =
    'You extract a structured summary from a phone call transcript for a lawn-care company. ' +
    'Reply with ONLY a single JSON object and nothing else — no prose, no code fences. ' +
    'Use this exact shape: {"name": string|null, "callback_phone": string|null, "address_or_area": string|null, ' +
    '"service_wanted": string|null, "timeframe": string|null, "urgency": "low"|"normal"|"high"|"emergency", ' +
    '"summary": string, "wants_callback": boolean, "soft_commitment": boolean, "recap_opt_in": boolean, ' +
    '"call_type": "sales_lead"|"complaint"|"scheduling"|"billing"|"existing_customer"|"other"}. ' +
    'Set a field to null if the caller did not provide it. ' +
    'callback_phone must be a COMPLETE phone number spoken by the CALLER (all ten digits). ' +
    'The assistant confirms a number by reading back ONLY its last four digits, so a partial or masked ' +
    'reference — "ending in one one eight five", "ends in 0536", "xxxx-xx-9201" — is NOT a phone number: ' +
    'return null for callback_phone in that case. Never pad, guess, or invent digits. ' +
    'call_type classifies WHY they called: "sales_lead" = a new customer, or anyone wanting a quote or to start a service the company actually offers; ' +
    '"complaint" = an unhappy caller complaining about service or a problem; ' +
    '"scheduling" = an existing customer asking about, or wanting to change, their visit schedule; ' +
    '"billing" = a question about a payment, invoice, or charge; ' +
    '"existing_customer" = an existing customer with another service question; "other" = anything else. ' +
    'A caller asking only about a service the company does NOT offer (for example, the assistant explained they do not provide it, or referred the caller to a different company) is NOT a sales_lead — use "other". ' +
    'When you are unsure whether it is a genuine sales lead, use "sales_lead" so a potential lead is never lost. ' +
    'soft_commitment is true ONLY if the caller explicitly agreed to move forward / get set up / have the team sign them up — not merely asking questions. ' +
    'recap_opt_in is true ONLY if the assistant offered to text a recap and the caller agreed (said yes / sure / that is fine). ' +
    'urgency is "emergency" for broken/leaking irrigation, flooding, or anything the caller frames as urgent; ' +
    '"high" for an upset caller or a complaint; otherwise "normal" (or "low" if clearly not time-sensitive). ' +
    'summary is one or two plain sentences a teammate can read at a glance. Do not invent details.'

  try {
    const anthropic = getAnthropic({ timeout: 60_000, maxRetries: 2 })
    const resp = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      system,
      messages: [{ role: 'user', content: `Call transcript:\n\n${transcriptText.slice(0, 6000)}` }],
    })
    const block = resp.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') return null
    let text = block.text.trim()
    // Strip accidental code fences.
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    }
    // Grab the outermost JSON object if the model added stray text.
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1 || end < start) return null
    const parsed = JSON.parse(text.slice(start, end + 1)) as Partial<ExtractedLead>

    const urgency = URGENCY_VALUES.includes(parsed.urgency as ExtractedLead['urgency'])
      ? (parsed.urgency as ExtractedLead['urgency'])
      : 'normal'
    const call_type = CALL_TYPE_VALUES.includes(parsed.call_type as CallType)
      ? (parsed.call_type as CallType)
      : 'sales_lead'

    return {
      name: (parsed.name ?? null) || null,
      // Sanitized, never raw: a masked readback ("ending in 1185") must never
      // beat the caller ID we already know is dialable.
      callback_phone: dialablePhoneOrNull(parsed.callback_phone) || dialablePhoneOrNull(fallbackPhone),
      address_or_area: (parsed.address_or_area ?? null) || null,
      service_wanted: (parsed.service_wanted ?? null) || null,
      timeframe: (parsed.timeframe ?? null) || null,
      urgency,
      summary: (parsed.summary ?? null) || null,
      wants_callback: parsed.wants_callback !== false, // default true
      soft_commitment: parsed.soft_commitment === true,
      recap_opt_in: parsed.recap_opt_in === true,
      call_type,
    }
  } catch (err) {
    console.warn('[voice.wrapup] lead extraction failed', (err as Error).message)
    return null
  }
}

export async function POST(request: Request) {
  if (!bearerAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: WrapupBody
  try {
    body = (await request.json()) as WrapupBody
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  const companyId = body.companyId?.trim() || HEROES_COMPANY_ID
  const fromNumber = body.from?.trim() || null
  const turns = Array.isArray(body.transcript) ? body.transcript : []
  const transcriptText = renderTranscript(turns)

  const admin = createAdminClient()

  // Per-company receptionist settings (recap-text toggle + persona name).
  const vr = await getEffectiveVoiceReceptionistSettings(admin, companyId)

  // Did she actually BOOK something on this call? /api/voice/book records it
  // mid-call, because the office needs to see the job number wherever this wrap-up
  // ends up — and the two paths below end up in different places.
  //
  // ⚠ This deliberately does NOT hang off the lead. The wrap-up returns early for
  // 'scheduling' / 'existing_customer' / 'complaint' / 'billing' calls and posts an
  // Office Alert INSTEAD of creating a lead — and a direct booking requires an
  // existing Jobber customer, so a booked call is almost always exactly one of those.
  // Stamping only the Tracker row would have put the job number nowhere on the
  // calls that actually produce jobs.
  let bookedLine: string | null = null
  if (body.callSid) {
    try {
      const { data: bk } = await admin
        .from('voice_bookings')
        .select('job_number, job_title, booked_date, needs_office_attention')
        .eq('call_sid', body.callSid)
        .order('created_at', { ascending: false })
        .limit(1)
      const b = (bk as { job_number: string | null; job_title: string | null; booked_date: string | null; needs_office_attention: boolean }[] | null)?.[0]
      if (b) {
        bookedLine =
          `📅 Booked in Jobber: ${b.job_title || 'job'}${b.job_number ? ` (#${b.job_number})` : ''}` +
          `${b.booked_date ? ` for ${b.booked_date}` : ''}` +
          `${b.needs_office_attention ? ' — ⚠ needs a look: check the job title and that it is on the calendar' : ''}`
      }
    } catch (e) {
      // Never fail a wrap-up over a cosmetic line.
      console.warn('[voice.wrapup] booking lookup failed', (e as Error).message)
    }
  }

  // 1) Extract (best-effort; falls back to a minimal lead on failure).
  const extracted = await extractLead(transcriptText, fromNumber)

  const { first, last } = splitName(extracted?.name ?? null)
  // The number that lands on the lead: the caller's stated callback number when
  // we captured all ten digits, else the caller ID. Both are validated, so the
  // Lead Tracker gets a dialable number or nothing at all — never a fragment.
  const callerAni = dialablePhoneOrNull(fromNumber)
  const callbackPhone = extracted?.callback_phone || callerAni
  const leadPhone = callbackPhone ? formatPhone(callbackPhone) || callbackPhone : null
  // Worth recording when the caller asked to be reached somewhere else.
  const altAni = callerAni && callbackPhone && callerAni !== callbackPhone ? callerAni : null
  const service = extracted?.service_wanted || null
  const summary = extracted?.summary || 'After-hours AI receptionist call (no summary extracted).'
  const urgency = extracted?.urgency || 'normal'

  // Close out the `calls` row (inserted by /api/voice/brain at call start) —
  // status, duration, transcript, summary. Unconditional: call-logging must
  // happen regardless of VOICE_TEST_MODE, which only gates lead/notify writes.
  if (body.callSid) {
    const startedAt = body.startedAt ? new Date(body.startedAt) : null
    const endedAt = body.endedAt ? new Date(body.endedAt) : new Date()
    const durationSeconds =
      startedAt && !isNaN(startedAt.getTime())
        ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
        : null
    await admin
      .from('calls')
      .update({
        status: 'completed',
        ended_at: endedAt.toISOString(),
        duration_seconds: durationSeconds,
        transcript: transcriptText || null,
        ai_summary: summary,
      })
      .eq('twilio_call_sid', body.callSid)
      .then(({ error }) => {
        if (error) console.warn('[voice.wrapup] calls row close-out failed', error.message)
      })
  }

  // ── TEST MODE ──────────────────────────────────────────────────────────
  // When VOICE_TEST_MODE=true (staging, during testing), do NOT write to the
  // shared Lead Tracker / Queue / directory — staging + prod share ONE DB, so
  // test calls would otherwise show up as real leads everyone sees. Instead,
  // just DM the captured info to the notify users (Ben) via Guardian. Flip the
  // flag off to resume full lead capture.
  if (process.env.VOICE_TEST_MODE === 'true') {
    const callerName = extracted?.name || 'Unknown caller'
    const callType = extracted?.call_type || 'sales_lead'
    const urgentFlag = urgency === 'emergency' || urgency === 'high' || callType === 'complaint'
    const facts: string[] = []
    facts.push(`Call type: ${callType}`)
    if (extracted?.name) facts.push(`Name: ${extracted.name}`)
    if (callbackPhone) facts.push(`Callback: ${formatPhone(callbackPhone) || callbackPhone}`)
    if (altAni) facts.push(`Called from: ${formatPhone(altAni) || altAni}`)
    if (extracted?.address_or_area) facts.push(`Address/area: ${extracted.address_or_area}`)
    if (service) facts.push(`Service: ${service}`)
    if (extracted?.timeframe) facts.push(`Timeframe: ${extracted.timeframe}`)
    facts.push(`Urgency: ${urgency}`)
    if (extracted?.soft_commitment) facts.push('🔥 Soft commitment: said YES to moving forward')
    if (extracted?.recap_opt_in)
      facts.push(
        `Recap text: caller opted in${vr.recapTextEnabled ? ' (would send on the live line)' : ' (recap texts are turned off)'}`,
      )
    const dmBody =
      `🧪 TEST — AI Receptionist call (NOT saved to the Lead Tracker)\n` +
      `${urgentFlag ? '🔴 ' : ''}Caller: ${callerName}` +
      `${fromNumber ? ` (${formatPhone(fromNumber) || fromNumber})` : ''}\n\n` +
      `${summary}\n\n${facts.join('\n')}` +
      `${transcriptText.trim() ? `\n\n--- Transcript ---\n${transcriptText}` : ''}`
    after(async () => {
      try {
        const userIds = notifyUserIds()
        await fanoutGuardianNotification({ companyId, userIds, roomIds: [], body: dmBody, admin })
        await sendHubPush(
          userIds,
          {
            title: '🧪 AI Receptionist (test call)',
            body: `${callerName}: ${service || summary}`.slice(0, 120),
            url: '/hub',
            type: 'lead',
          },
          { isDm: true },
        )
      } catch (e) {
        console.warn('[voice.wrapup] test-mode DM failed', (e as Error).message)
      }
    })
    return NextResponse.json({ ok: true, testMode: true })
  }

  // ── SERVICE CALLS (PRD §18) ───────────────────────────────────────────────
  // Not every call is a sales lead. Complaints, scheduling, and billing calls
  // are from EXISTING customers and must NOT be filed as new leads — they're
  // routed to the office to work (Hub Queue + notification), with complaints
  // flagged urgent. When the classifier is unsure it returns 'sales_lead', which
  // falls through to the normal lead path below (so a real lead is never lost).
  const callType: CallType = extracted?.call_type || 'sales_lead'
  if (callType !== 'sales_lead') {
    const meta = SERVICE_CALL_META[callType]
    const callerName = extracted?.name || 'Unknown caller'
    const urgent = callType === 'complaint' || urgency === 'emergency' || urgency === 'high'
    after(async () => {
      // Hub Queue — land the caller like any inbound so the office can triage.
      try {
        const queuePhone = fromNumber || callbackPhone
        if (queuePhone) {
          const contactId = await findOrCreateContactByPhone(admin, companyId, queuePhone)
          if (contactId) {
            await ensureInboundQueueConversation(admin, {
              companyId,
              contactId,
              preview: `${meta.emoji} ${meta.label} — ${callerName}`,
              at: body.endedAt || undefined,
            })
          }
        }
      } catch (e) {
        console.warn('[voice.wrapup] service queue ensure failed', (e as Error).message)
      }

      // Notify the office with a single post in the "Office Alerts" room (no
      // Guardian DM, no push — per Ben, the room post is the one surface). The
      // headline is the whole post; the summary sits in its thread. Complaints
      // get the 🔴 urgent flag inline.
      try {
        await postOfficeAlert(admin, companyId, {
          title:
            `${urgent ? '🔴 ' : ''}${meta.emoji} ${meta.label} from ${callerName}` +
            `${callbackPhone ? ` (${formatPhone(callbackPhone) || callbackPhone})` : ''}`,
          details: [summary, ...(bookedLine ? [bookedLine] : []), 'Work it in the Hub Queue → /hub/txt'],
        })
      } catch (e) {
        console.warn('[voice.wrapup] service notify failed', (e as Error).message)
      }
    })
    return NextResponse.json({ ok: true, callType })
  }

  // 2) Insert the lead (mirrors the Angi webhook shape).
  const { data: lead, error: leadErr } = await admin
    .from('leads')
    .insert({
      company_id: companyId,
      first_name: first,
      last_name: last,
      phone: leadPhone,
      service: service ? [service] : null,
      lead_source: 'AI Receptionist',
      status: 'Current',
      stage: 'current',
      service_address: extracted?.address_or_area || null,
    })
    .select('id')
    .single()

  if (leadErr || !lead) {
    console.error('[voice.wrapup] lead insert failed', leadErr)
    return NextResponse.json({ error: leadErr?.message || 'lead_insert_failed' }, { status: 500 })
  }

  const leadId = lead.id as string

  // First note: summary + captured fields + full transcript.
  const noteLines: string[] = ['☎️ After-hours AI receptionist call', '', summary]
  const facts: string[] = []
  if (extracted?.name) facts.push(`Name: ${extracted.name}`)
  if (callbackPhone) facts.push(`Callback: ${formatPhone(callbackPhone) || callbackPhone}`)
  if (altAni) facts.push(`Called from: ${formatPhone(altAni) || altAni}`)
  if (extracted?.address_or_area) facts.push(`Address/area: ${extracted.address_or_area}`)
  if (service) facts.push(`Service: ${service}`)
  if (extracted?.timeframe) facts.push(`Timeframe: ${extracted.timeframe}`)
  facts.push(`Urgency: ${urgency}`)
  if (extracted) facts.push(`Wants callback: ${extracted.wants_callback ? 'yes' : 'no'}`)
  if (extracted?.recap_opt_in)
    facts.push(`Recap text: opted in${vr.recapTextEnabled ? ' (recap text sent)' : ' (recap texts off)'}`)
  if (bookedLine) facts.push(bookedLine)
  if (facts.length) noteLines.push('', facts.join('\n'))
  if (transcriptText.trim()) noteLines.push('', '--- Transcript ---', transcriptText)

  await admin
    .from('lead_notes')
    .insert({
      lead_id: leadId,
      company_id: companyId,
      note: noteLines.join('\n'),
      created_by: 'AI Receptionist',
    })
    .then(({ error }) => {
      if (error) console.warn('[voice.wrapup] lead note insert failed', error.message)
    })

  const callerName = extracted?.name || 'Unknown caller'
  const urgentFlag = urgency === 'emergency' || urgency === 'high'

  // 3 + 4) Side effects — directory sync, Hub Queue, notifications. All
  // best-effort and run post-response; a failure here must never fail the
  // wrap-up (the lead is already saved).
  after(async () => {
    // Contacts directory (mirrors the Angi webhook).
    try {
      await syncLeadToDirectory(admin, companyId, {
        first_name: first,
        last_name: last,
        phone: leadPhone,
        email: null,
      })
    } catch (e) {
      console.warn('[voice.wrapup] directory sync failed', (e as Error).message)
    }

    // Hub Queue — land the caller like any inbound so the office can triage.
    try {
      const queuePhone = fromNumber || callbackPhone
      if (queuePhone) {
        const contactId = await findOrCreateContactByPhone(admin, companyId, queuePhone)
        if (contactId) {
          const preview = `☎️ After-hours AI call — ${service || 'message'} (${callerName})`
          await ensureInboundQueueConversation(admin, {
            companyId,
            contactId,
            preview,
            at: body.endedAt || undefined,
          })
        }
      }
    } catch (e) {
      console.warn('[voice.wrapup] queue ensure failed', (e as Error).message)
    }

    // Notify the office with a single post in the "Office Alerts" room (no
    // Guardian DM, no push — per Ben, the room post is the one surface). The
    // headline is the whole post; the call detail sits in its thread.
    try {
      // The callback number is in the headline now, so it's left out here rather
      // than printed twice.
      const line2 = [
        service && `Service: ${service}`,
        extracted?.address_or_area,
        `Urgency: ${urgency}`,
      ]
        .filter(Boolean)
        .join(' · ')
      await postOfficeAlert(admin, companyId, {
        title:
          `${urgentFlag ? '🔴 ' : ''}☎️ After-hours AI call: ${callerName}` +
          `${callbackPhone ? ` (${formatPhone(callbackPhone) || callbackPhone})` : ''}`,
        details: [
          extracted?.soft_commitment && '🔥 Soft commitment — said YES to moving forward',
          bookedLine,
          line2,
          summary,
          'Open the Lead Tracker → /hub/tracker',
        ],
      })
    } catch (e) {
      console.warn('[voice.wrapup] notify failed', (e as Error).message)
    }

    // Recap text — only when the receptionist has it enabled AND the caller
    // opted in on the call. Reuses the standard Txt send (adds the signature +
    // the first-message "Reply STOP to opt out" notice, lands in the unified Txt
    // inbox). Best-effort — never fails the wrap-up.
    try {
      const recapPhone = fromNumber || callbackPhone
      if (vr.recapTextEnabled && extracted?.recap_opt_in && recapPhone) {
        const hi = first ? `Hi ${first}, ` : 'Hi, '
        const svc = service ? ` about ${lowerFirstForSentence(service)}` : ''
        const { businessName } = await getBusinessProfile(admin, companyId)
        const recapBody =
          `${hi}thanks for calling ${businessName}! This is ${vr.receptionistName}, following up with a quick recap of your call${svc}. ` +
          `A team member will reach out shortly to take care of everything for you.`
        // Sign as the AI persona (Amber) so the recap doesn't read "This is Amber
        // … - Ben". Thread stays OWNED by the notify user so a customer reply
        // still routes to a human. Falls back to the notify user when no bot
        // user is configured.
        const botUserId = await getAiTextBotUserId(admin, companyId)
        const res = await sendDirectTxtToPhone({
          admin,
          companyId,
          userId: notifyUserIds()[0],
          signatureUserId: botUserId,
          phone: recapPhone,
          name: extracted?.name ?? null,
          body: recapBody,
        })
        if (!res.ok) console.warn('[voice.wrapup] recap text failed', res.error)
      }
    } catch (e) {
      console.warn('[voice.wrapup] recap text failed', (e as Error).message)
    }
  })

  return NextResponse.json({ ok: true, leadId })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: Boolean(process.env.VOICE_SERVICE_SECRET),
    route: 'voice.wrapup',
  })
}
