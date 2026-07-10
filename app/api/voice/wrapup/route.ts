import { NextResponse, after } from 'next/server'
import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import { syncLeadToDirectory } from '@/lib/contacts-directory'
import {
  ensureInboundQueueConversation,
  findOrCreateContactByPhone,
} from '@/lib/txt-inbound-queue'
import { fanoutGuardianNotification, postGuardianToRoom } from '@/lib/guardian-post'
import { sendHubPush } from '@/lib/hub-push'
import { formatPhone } from '@/lib/format'

// AI Voice Receptionist — "wrap-up" endpoint (Phase 1a).
//
// The ConversationRelay WS service POSTs here once the after-hours call ends,
// with the full transcript. We:
//   1. Extract a structured lead from the transcript (one non-streaming Claude call).
//   2. Insert a `leads` row (lead_source='AI Receptionist') + a `lead_notes` row
//      carrying the summary + full transcript, and mirror to the contacts directory.
//   3. Surface the caller in the Hub Queue like any inbound (find-or-create
//      contact + unassigned conversation).
//   4. Notify the office (room post + Guardian DM + push) so it's worked ASAP.
//
// Steps 3–4 are best-effort side effects (via after()) — a failure there must
// never fail the wrap-up. Auth: Authorization: Bearer <VOICE_SERVICE_SECRET>.

export const runtime = 'nodejs'

const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'
// The Hub "office" room (matches the Angi webhook) + Ben's Hub user id (matches
// the feedback route's notify default). Both env-overridable.
const OFFICE_ROOM_ID =
  process.env.VOICE_OFFICE_ROOM_ID || 'cebac7e5-caf8-400c-a15d-5eb9d81e1967'
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
}

const URGENCY_VALUES: ExtractedLead['urgency'][] = ['low', 'normal', 'high', 'emergency']

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

function splitName(full: string | null): { first: string | null; last: string | null } {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { first: null, last: null }
  if (parts.length === 1) return { first: parts[0], last: null }
  return { first: parts[0], last: parts.slice(1).join(' ') }
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
    'You extract a structured lead from an after-hours phone call transcript for a lawn-care company. ' +
    'Reply with ONLY a single JSON object and nothing else — no prose, no code fences. ' +
    'Use this exact shape: {"name": string|null, "callback_phone": string|null, "address_or_area": string|null, ' +
    '"service_wanted": string|null, "timeframe": string|null, "urgency": "low"|"normal"|"high"|"emergency", ' +
    '"summary": string, "wants_callback": boolean, "soft_commitment": boolean}. ' +
    'Set a field to null if the caller did not provide it. ' +
    'soft_commitment is true ONLY if the caller explicitly agreed to move forward / get set up / have the team sign them up — not merely asking questions. ' +
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

    return {
      name: (parsed.name ?? null) || null,
      callback_phone: (parsed.callback_phone ?? null) || fallbackPhone,
      address_or_area: (parsed.address_or_area ?? null) || null,
      service_wanted: (parsed.service_wanted ?? null) || null,
      timeframe: (parsed.timeframe ?? null) || null,
      urgency,
      summary: (parsed.summary ?? null) || null,
      wants_callback: parsed.wants_callback !== false, // default true
      soft_commitment: parsed.soft_commitment === true,
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

  // 1) Extract (best-effort; falls back to a minimal lead on failure).
  const extracted = await extractLead(transcriptText, fromNumber)

  const { first, last } = splitName(extracted?.name ?? null)
  const callbackPhone = extracted?.callback_phone || fromNumber
  const leadPhone = callbackPhone ? formatPhone(callbackPhone) || callbackPhone : null
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
    const urgentFlag = urgency === 'emergency' || urgency === 'high'
    const facts: string[] = []
    if (extracted?.name) facts.push(`Name: ${extracted.name}`)
    if (callbackPhone) facts.push(`Callback: ${formatPhone(callbackPhone) || callbackPhone}`)
    if (extracted?.address_or_area) facts.push(`Address/area: ${extracted.address_or_area}`)
    if (service) facts.push(`Service: ${service}`)
    if (extracted?.timeframe) facts.push(`Timeframe: ${extracted.timeframe}`)
    facts.push(`Urgency: ${urgency}`)
    if (extracted?.soft_commitment) facts.push('🔥 Soft commitment: said YES to moving forward')
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
  if (extracted?.address_or_area) facts.push(`Address/area: ${extracted.address_or_area}`)
  if (service) facts.push(`Service: ${service}`)
  if (extracted?.timeframe) facts.push(`Timeframe: ${extracted.timeframe}`)
  facts.push(`Urgency: ${urgency}`)
  if (extracted) facts.push(`Wants callback: ${extracted.wants_callback ? 'yes' : 'no'}`)
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

    // Notify the office: room post + Guardian DM(s) + push.
    try {
      const userIds = notifyUserIds()
      const line2 = [
        callbackPhone && `Callback: ${formatPhone(callbackPhone) || callbackPhone}`,
        service && `Service: ${service}`,
        extracted?.address_or_area,
        `Urgency: ${urgency}`,
      ]
        .filter(Boolean)
        .join(' · ')
      const bodyText =
        `${urgentFlag ? '🔴 ' : ''}☎️ After-hours AI call: ${callerName}` +
        `${extracted?.soft_commitment ? '\n🔥 Soft commitment — said YES to moving forward' : ''}` +
        `${line2 ? `\n${line2}` : ''}` +
        `\n${summary}` +
        `\nOpen the Lead Tracker → /hub/tracker`

      await postGuardianToRoom(OFFICE_ROOM_ID, bodyText, { admin })
      await fanoutGuardianNotification({ companyId, userIds, roomIds: [], body: bodyText, admin })
      await sendHubPush(
        userIds,
        {
          title: `${urgentFlag ? '🔴 ' : '☎️ '}After-hours AI call`,
          body: `${callerName}: ${service || summary}`.slice(0, 120),
          url: '/hub/tracker',
          type: 'lead',
        },
        { isDm: true }
      )
    } catch (e) {
      console.warn('[voice.wrapup] notify failed', (e as Error).message)
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
