import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGuardianModel } from '@/lib/guardian-knowledge'
import { writeAuditLog } from '@/lib/guardian-audit'

// "Suggest reply" for Hub Rooms and DMs. Generates a suggested internal
// team message based on recent conversation context. Tone options:
// professional, friendly, funny. Gated on can_access_hub.

type Tone = 'professional' | 'friendly' | 'funny'
const ALLOWED_TONES: Tone[] = ['professional', 'friendly', 'funny']

const MAX_HISTORY_MESSAGES = 10
const MAX_TOKENS = 300

type MessageRow = {
  content: string | null
  created_at: string
  sender: { display_name: string | null } | { display_name: string | null }[] | null
}

function unwrapSender(s: MessageRow['sender']): { display_name: string | null } | null {
  if (!s) return null
  return Array.isArray(s) ? s[0] || null : s
}

function formatHistory(rows: MessageRow[]): string {
  return rows
    .map((m) => {
      const text = (m.content || '').trim()
      if (!text) return null
      const sender = unwrapSender(m.sender)
      const name = sender?.display_name?.split(' ')[0] || 'Someone'
      return `[${name}] ${text}`
    })
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

function buildSystemPrompt(tone: Tone): string {
  const toneGuide: Record<Tone, string> = {
    professional: 'Clear, concise, and business-appropriate. Direct and helpful without being stiff.',
    friendly: 'Warm and approachable — how a close teammate would talk. Casual but still sensible.',
    funny: 'Light-hearted and witty. Keep it work-appropriate but make it fun — a little humor goes a long way.',
  }

  return [
    `You are helping a Heroes Lawn Care team member compose an internal message to their colleagues in the company's team chat app (Hub).`,
    ``,
    `Your task: suggest a single natural internal message they can send as-is or lightly edit.`,
    `Tone: ${tone} — ${toneGuide[tone]}`,
    ``,
    `Rules:`,
    `- Write as a Heroes Lawn Care team member, not as an AI`,
    `- Keep it concise and chat-appropriate (1–3 sentences is usually right)`,
    `- Do NOT include a greeting like "Hey everyone..." unless it fits naturally`,
    `- Do NOT mention that you are an AI`,
    `- Return ONLY the message body. No prefixes, no quotes, no commentary.`,
  ].join('\n')
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const roomId = typeof body.room_id === 'string' ? body.room_id : null
  const conversationId = typeof body.conversation_id === 'string' ? body.conversation_id : null
  if (!roomId && !conversationId) {
    return NextResponse.json({ error: 'room_id or conversation_id required' }, { status: 400 })
  }

  const requestedTone = typeof body.tone === 'string' ? body.tone.toLowerCase() : ''
  const tone: Tone = (ALLOWED_TONES as string[]).includes(requestedTone)
    ? (requestedTone as Tone)
    : 'professional'

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_hub')
    .eq('id', user.id)
    .single()

  if (!profile?.can_access_hub) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!profile.company_id) {
    return NextResponse.json({ error: 'No company' }, { status: 403 })
  }
  const companyId = profile.company_id

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Guardian not configured' })
  }

  let query = supabase
    .from('messages')
    .select('content, created_at, sender:hub_users!sender_id ( display_name )')
    .eq('company_id', companyId)
    .is('parent_id', null)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY_MESSAGES)

  if (roomId) {
    query = query.eq('room_id', roomId)
  } else {
    query = query.eq('conversation_id', conversationId!)
  }

  const { data: rows, error: queryErr } = await query
  if (queryErr) {
    return NextResponse.json({ error: queryErr.message }, { status: 500 })
  }

  const messages = ((rows ?? []) as MessageRow[]).reverse()

  if (messages.length === 0) {
    return NextResponse.json({ error: 'Nothing to reply to — this channel is empty.' })
  }

  const adminClient = createAdminClient()
  const model = await getGuardianModel(adminClient, companyId).catch(() => CLAUDE_MODEL)

  const historyText = formatHistory(messages)
  const userMessage = `Conversation history:\n${historyText}\n\n---\nSuggest a ${tone} reply to the most recent message.`

  let suggestion = ''
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  let lastError: string | null = null
  try {
    const anthropic = getAnthropic({ apiKey, timeout: 60_000, maxRetries: 2 })
    const response = await anthropic.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(tone),
      messages: [{ role: 'user', content: userMessage }],
    })
    suggestion = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    inputTokens = response.usage?.input_tokens ?? null
    outputTokens = response.usage?.output_tokens ?? null
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e)
    console.error('[hub suggest-reply] Anthropic call failed:', lastError)
  }

  writeAuditLog(adminClient, {
    companyId,
    userId: user.id,
    question: userMessage,
    answer: suggestion || null,
    model,
    toolsCalled: [],
    webSearchesUsed: 0,
    inputTokens,
    outputTokens,
    isTest: false,
    guardianTier: 'basic',
    roomId: roomId ?? null,
    conversationId: conversationId ?? null,
  })

  if (lastError || !suggestion) {
    return NextResponse.json({ error: 'Could not generate a suggestion. Please try again.' })
  }

  return NextResponse.json({ suggestion, tone })
}
