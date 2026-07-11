import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGuardianModel } from '@/lib/guardian-knowledge'
import { buildGuardianSystem } from '@/lib/guardian-persona'
import { writeAuditLog } from '@/lib/guardian-audit'

// "Catch me up" — Unified Inbox Session 5. A 2–3 sentence roll-up of the whole
// relationship with one contact, built from data we ALREADY have stored: the
// merged timeline (texts + calls + voicemails + notes) with each call/voicemail's
// pre-computed ai_summary. No new transcription — a cheap Claude summarization
// over existing rows.
//
// Access mirrors GET /api/txt/timeline exactly: gated on can_access_unified_inbox
// (or admin). This is a READ-ALL view; it doesn't send or call anything.

const MAX_EVENTS = 40
const MAX_TOKENS = 220

type TimelineEvent = {
  kind: 'text' | 'call' | 'voicemail' | 'note'
  ts: string
  direction: string | null
  body: string | null
  status: string | null
  duration_seconds: number | null
  summary: string | null
  transcript: string | null
  voicemail_id: string | null
  ai_reply_sent_at: string | null
}

function fmtDuration(sec: number | null): string {
  if (!sec || sec <= 0) return ''
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return ` ${m}:${String(s).padStart(2, '0')}`
}

// Collapse the merged timeline into a compact, token-cheap digest. Texts carry
// their body; calls/voicemails carry their stored summary (or a thin descriptor
// if none) so the model never has to read a raw transcript.
function buildDigest(events: TimelineEvent[]): string {
  return events
    .map((e) => {
      const day = e.ts.slice(0, 10)
      if (e.kind === 'text') {
        const who = e.direction === 'inbound' ? 'Customer' : 'Staff'
        const text = (e.body || '').trim()
        if (!text) return null
        return `${day} [${who} text] ${text}`
      }
      if (e.kind === 'note') {
        const text = (e.body || '').trim()
        return text ? `${day} [Internal note] ${text}` : null
      }
      // call (possibly with a folded voicemail) or orphan voicemail
      const dir = e.direction === 'inbound' ? 'inbound' : 'outbound'
      const hasVm = !!e.voicemail_id || e.kind === 'voicemail'
      const missed = e.status === 'no-answer' || e.status === 'voicemail'
      const label = hasVm
        ? `${missed ? 'Missed call + voicemail' : 'Voicemail'}`
        : `${dir} call${fmtDuration(e.duration_seconds)}`
      const summary = (e.summary || '').trim()
      const replied = e.ai_reply_sent_at ? ' (Guardian auto-replied)' : ''
      return `${day} [${label}]${replied}${summary ? ` — ${summary}` : ''}`
    })
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

// Task-specific layer. Shared identity + voice come from GUARDIAN_CORE via
// buildGuardianSystem(); this only describes the summarize job.
const CATCH_UP_TASK = [
  `Your task: summarize a customer's full communication history for Heroes Lawn Care staff who are about to text or call them and need to get up to speed fast.`,
  ``,
  `Write 2–3 short sentences, plain and skimmable, covering:`,
  `- When and how they were last in contact, and roughly how long the relationship has run.`,
  `- What the recent conversation has been about (the substance — jobs, quotes, issues).`,
  `- Anything OPEN or needing a follow-up (an unanswered voicemail, an unreplied question, a promised callback).`,
  ``,
  `Rules:`,
  `- Only use facts present in the history. Never invent dates, prices, or commitments.`,
  `- Be specific where the data is specific; stay vague where it's vague.`,
  `- No greeting, no preamble, no bullet points, no "Here's a summary". Just the 2–3 sentences.`,
  `- Do NOT mention that you are an AI.`,
].join('\n')

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: conversationId } = await params

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_access_unified_inbox, guardian_tier')
    .eq('id', user.id)
    .single()

  const canRead = profile?.role === 'admin' || profile?.can_access_unified_inbox === true
  if (!canRead) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!profile?.company_id) {
    return NextResponse.json({ error: 'No company' }, { status: 403 })
  }
  const companyId = profile.company_id

  // Resolve the conversation's contact (the timeline spine). RLS already scopes
  // this to the caller's company.
  const { data: conv } = await supabase
    .from('txt_conversations')
    .select('contact_id')
    .eq('id', conversationId)
    .maybeSingle()
  const contactId = (conv as { contact_id: string | null } | null)?.contact_id
  if (!contactId) {
    return NextResponse.json({
      error: 'No contact on this conversation to summarize.',
    })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Guardian not configured' })
  }

  // The dedup'd, company-scoped merged timeline — same RPC the read endpoint uses.
  const { data: events, error: rpcError } = await supabase.rpc('get_contact_timeline', {
    p_contact_id: contactId,
    p_company_id: companyId,
  })
  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 500 })
  }

  const all = (events ?? []) as TimelineEvent[]
  if (all.length === 0) {
    return NextResponse.json({
      summary: 'No history with this contact yet.',
    })
  }

  // Keep the most recent MAX_EVENTS (RPC returns oldest→newest).
  const recent = all.slice(-MAX_EVENTS)
  const digest = buildDigest(recent)
  if (!digest.trim()) {
    return NextResponse.json({ summary: 'No readable history with this contact yet.' })
  }

  const adminClient = createAdminClient()
  const [model, system] = await Promise.all([
    getGuardianModel(adminClient, companyId).catch(() => CLAUDE_MODEL),
    buildGuardianSystem({ companyId, knowledge: 'voice', surface: 'guardian', task: CATCH_UP_TASK, admin: adminClient }),
  ])

  const userMessage = `Communication history (oldest to newest):\n${digest}\n\n---\nCatch me up on this customer in 2–3 sentences.`

  let summary = ''
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  let lastError: string | null = null
  try {
    const anthropic = getAnthropic({ apiKey, timeout: 60_000, maxRetries: 2 })
    const response = await anthropic.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: userMessage }],
    })
    summary = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    inputTokens = response.usage?.input_tokens ?? null
    outputTokens = response.usage?.output_tokens ?? null
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e)
    console.error('[catch-me-up] Anthropic call failed:', lastError)
  }

  writeAuditLog(adminClient, {
    companyId,
    userId: user.id,
    question: userMessage,
    answer: summary || null,
    model,
    toolsCalled: [],
    webSearchesUsed: 0,
    inputTokens,
    outputTokens,
    isTest: false,
    guardianTier: profile.guardian_tier ?? 'basic',
    roomId: null,
    conversationId,
  })

  if (lastError || !summary) {
    return NextResponse.json({
      error: 'Could not generate a summary. Please try again.',
    })
  }

  return NextResponse.json({ summary })
}
