import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGuardianModel } from '@/lib/guardian-knowledge'
import { writeAuditLog } from '@/lib/guardian-audit'

// "Polish draft" for Hub Rooms and DMs. Refines the user's own draft —
// grammar, spelling, clarity — WITHOUT replacing their intent or voice.
// Gated on can_access_hub. Internal team message style (not SMS).

const MAX_HISTORY_MESSAGES = 6
const MAX_TOKENS = 400
const MAX_DRAFT_CHARS = 2000

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

const SYSTEM_PROMPT = [
  `You are an editor helping a Heroes Lawn Care team member polish a draft internal message before they send it in the company team chat.`,
  ``,
  `Your job is to refine the team member's OWN draft — fix grammar, spelling, punctuation, and capitalization; tighten clarity; smooth tone to be warm and collegial — WITHOUT changing what they are trying to say.`,
  ``,
  `Rules:`,
  `- Preserve the team member's intent, meaning, and any specific facts, names, dates, or numbers they wrote. Never invent details.`,
  `- Keep it the team member's voice — refine, don't rewrite from scratch.`,
  `- Chat-appropriate and concise. Do not add formal greetings like "Dear..." or sign-offs unless the draft already had one.`,
  `- Match the tone of the conversation history provided (for register only — do NOT answer the conversation, only polish the given draft).`,
  `- If the draft is already clean, return it essentially unchanged.`,
  `- Do NOT mention that you are an AI. Do NOT add commentary, quotes, or prefixes.`,
  `- Return ONLY the polished message body.`,
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

  const rawDraft = typeof body.draft_text === 'string' ? body.draft_text : ''
  const draft = rawDraft.trim().slice(0, MAX_DRAFT_CHARS)
  if (!draft) {
    return NextResponse.json({ error: 'Nothing to polish — type a draft first.' })
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
  const historyText = formatHistory(messages)

  const adminClient = createAdminClient()
  const model = await getGuardianModel(adminClient, companyId).catch(() => CLAUDE_MODEL)

  const userMessage = [
    historyText
      ? `Recent conversation (for tone/register only — do not answer it):\n${historyText}`
      : `(No prior messages — polish on its own merits.)`,
    ``,
    `---`,
    `Polish this draft and return only the cleaned-up message body:`,
    draft,
  ].join('\n')

  let refined = ''
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
    refined = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    inputTokens = response.usage?.input_tokens ?? null
    outputTokens = response.usage?.output_tokens ?? null
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e)
    console.error('[hub refine-draft] Anthropic call failed:', lastError)
  }

  writeAuditLog(adminClient, {
    companyId,
    userId: user.id,
    question: userMessage,
    answer: refined || null,
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

  if (lastError || !refined) {
    return NextResponse.json({ error: 'Could not polish the draft. Please try again.' })
  }

  return NextResponse.json({ refined })
}
