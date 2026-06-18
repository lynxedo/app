import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGuardianModel } from '@/lib/guardian-knowledge'
import { writeAuditLog } from '@/lib/guardian-audit'

// "Catch me up" for Hub Rooms and DMs. Summarizes the last N messages in a
// room or DM conversation so a user returning after being away knows what
// they missed. Gated on can_access_hub (any Hub user). No customer data —
// this is purely internal team conversation history.

const MAX_MESSAGES = 40
const MAX_TOKENS = 220

type MessageRow = {
  content: string | null
  created_at: string
  sender: { display_name: string | null } | { display_name: string | null }[] | null
}

function unwrapSender(s: MessageRow['sender']): { display_name: string | null } | null {
  if (!s) return null
  return Array.isArray(s) ? s[0] || null : s
}

function buildDigest(rows: MessageRow[]): string {
  return rows
    .map((m) => {
      const text = (m.content || '').trim()
      if (!text) return null
      const day = m.created_at.slice(0, 10)
      const sender = unwrapSender(m.sender)
      const name = sender?.display_name?.split(' ')[0] || 'Someone'
      return `${day} [${name}] ${text}`
    })
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

const SYSTEM_PROMPT = [
  `You are summarizing an internal team conversation for a Heroes Lawn Care employee who has been away from this channel and needs to get caught up quickly.`,
  ``,
  `Write 2–3 short sentences, plain and skimmable, covering:`,
  `- What the main topics or discussions were about.`,
  `- Any decisions made, action items assigned, or tasks mentioned.`,
  `- Anything open, unresolved, or that needs someone's attention.`,
  ``,
  `Rules:`,
  `- Only use facts present in the messages. Never invent details.`,
  `- Be specific where the data is specific; stay vague where it's vague.`,
  `- No greeting, no preamble, no bullet points, no "Here's a summary". Just the 2–3 sentences.`,
  `- Do NOT mention that you are an AI.`,
].join('\n')

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
    .is('parent_id', null) // top-level only — skip thread replies
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES)

  if (roomId) {
    query = query.eq('room_id', roomId)
  } else {
    query = query.eq('conversation_id', conversationId!)
  }

  const { data: rows, error: queryErr } = await query
  if (queryErr) {
    return NextResponse.json({ error: queryErr.message }, { status: 500 })
  }

  const messages = ((rows ?? []) as MessageRow[]).reverse() // chronological

  if (messages.length === 0) {
    return NextResponse.json({ summary: 'No messages in this channel yet.' })
  }

  const digest = buildDigest(messages)
  if (!digest.trim()) {
    return NextResponse.json({ summary: 'No readable messages to summarize.' })
  }

  const adminClient = createAdminClient()
  const model = await getGuardianModel(adminClient, companyId).catch(() => CLAUDE_MODEL)

  const userMessage = `Team conversation (oldest to newest):\n${digest}\n\n---\nCatch me up on what I missed in 2–3 sentences.`

  let summary = ''
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  let lastError: string | null = null
  try {
    const anthropic = getAnthropic({ apiKey, timeout: 60_000, maxRetries: 2 })
    const response = await anthropic.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
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
    console.error('[hub catch-me-up] Anthropic call failed:', lastError)
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
    guardianTier: 'basic',
    roomId: roomId ?? null,
    conversationId: conversationId ?? null,
  })

  if (lastError || !summary) {
    return NextResponse.json({ error: 'Could not generate a summary. Please try again.' })
  }

  return NextResponse.json({ summary })
}
