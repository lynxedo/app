import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxThreadPermissions } from '@/lib/inbox/permissions'
import { getGuardianModel } from '@/lib/guardian-knowledge'
import { buildGuardianSystem } from '@/lib/guardian-persona'
import { writeAuditLog } from '@/lib/guardian-audit'

export const dynamic = 'force-dynamic'

type Tone = 'professional' | 'friendly' | 'brief'
const ALLOWED_TONES: Tone[] = ['professional', 'friendly', 'brief']

const MAX_HISTORY_MESSAGES = 12
const MAX_TOKENS = 700
const MAX_MSG_CHARS = 1500

type MessageRow = {
  direction: 'inbound' | 'outbound'
  body_text: string | null
  body_html: string | null
  snippet: string | null
  from_name: string | null
  sent_by_user_id: string | null
  message_date: string | null
}

// Collapse an email HTML body to plain text for the prompt.
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|br|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function messageText(m: MessageRow): string {
  const raw = (m.body_text || '').trim() || (m.body_html ? htmlToText(m.body_html) : '') || (m.snippet || '').trim()
  return raw.length > MAX_MSG_CHARS ? raw.slice(0, MAX_MSG_CHARS) + '\n…(truncated)' : raw
}

// Format the last N messages chronologically with [Customer] / [Staff - Name] labels.
function formatHistory(rows: MessageRow[], staffNames: Record<string, string>): string {
  return rows
    .map((m) => {
      const text = messageText(m)
      if (!text) return null
      if (m.direction === 'inbound') return `[Customer] ${text}`
      const name = (m.sent_by_user_id && staffNames[m.sent_by_user_id]) || m.from_name || 'Staff'
      const first = name.split(/\s+/)[0]
      return `[Staff - ${first}] ${text}`
    })
    .filter((line): line is string => Boolean(line))
    .join('\n\n')
}

function buildSuggestTask(tone: Tone): string {
  return [
    `Your task: suggest a single, natural EMAIL reply that Heroes Lawn Care staff can send to the customer as-is or lightly edit.`,
    `Tone: ${tone}`,
    `Rules:`,
    `- Write as a Heroes Lawn Care staff member, not as an AI.`,
    `- Match the tone and register of the conversation history.`,
    `- Email-appropriate: a short greeting is fine, then the body. Do NOT invent a subject line — the reply keeps the thread's subject.`,
    `- Do NOT add a sign-off signature block — the app appends the sender's signature automatically.`,
    `- Do NOT mention that you are an AI.`,
    `- Use the customer-service knowledge as a style guide, not copy-paste templates.`,
    `- Only reference a specific date, time, or price if it appears in the account info or conversation.`,
    `- Return ONLY the email body text. No subject, no quotes, no commentary.`,
  ].join('\n')
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId, companyId, supabase } = auth

  const { id } = await params

  const perms = await getInboxThreadPermissions(supabase, id, userId)
  if (!perms.canReply) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const requestedTone = typeof body.tone === 'string' ? body.tone.toLowerCase() : ''
  const tone: Tone = (ALLOWED_TONES as string[]).includes(requestedTone)
    ? (requestedTone as Tone)
    : 'professional'

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Guardian not configured' })

  const admin = createAdminClient()

  const [messagesRes, model] = await Promise.all([
    // Cookie client so the thread-scoped RLS applies (belt-and-suspenders with the perms gate).
    supabase
      .from('inbox_messages')
      .select('direction, body_text, body_html, snippet, from_name, sent_by_user_id, message_date')
      .eq('thread_id', id)
      .order('message_date', { ascending: false })
      .limit(MAX_HISTORY_MESSAGES),
    getGuardianModel(admin, companyId).catch(() => CLAUDE_MODEL),
  ])

  const messages = ((messagesRes.data || []) as MessageRow[]).reverse() // chronological
  if (messages.length === 0) {
    return NextResponse.json({ error: 'Nothing to reply to — this thread is empty.' })
  }

  // Resolve staff display names for outbound-message labels.
  const staffIds = [...new Set(messages.map((m) => m.sent_by_user_id).filter((x): x is string => !!x))]
  const staffNames: Record<string, string> = {}
  if (staffIds.length > 0) {
    const { data: hus } = await admin.from('hub_users').select('id, display_name').in('id', staffIds)
    for (const h of (hus ?? []) as { id: string; display_name: string | null }[]) {
      if (h.display_name) staffNames[h.id] = h.display_name
    }
  }

  const systemPrompt = await buildGuardianSystem({
    companyId,
    knowledge: 'customer',
    surface: 'guardian',
    task: buildSuggestTask(tone),
    admin,
  })

  const historyText = formatHistory(messages, staffNames)
  const userMessage = `Conversation history:\n${historyText}\n\n---\nSuggest a ${tone} email reply to the most recent customer message.`

  let reply = ''
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  let lastError: string | null = null
  try {
    const anthropic = getAnthropic({ apiKey, timeout: 60_000, maxRetries: 2 })
    const response = await anthropic.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })
    reply = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    inputTokens = response.usage?.input_tokens ?? null
    outputTokens = response.usage?.output_tokens ?? null
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e)
    console.error('[inbox:suggest-reply] Anthropic call failed:', lastError)
  }

  writeAuditLog(admin, {
    companyId,
    userId,
    question: userMessage,
    answer: reply || null,
    model,
    toolsCalled: [],
    webSearchesUsed: 0,
    inputTokens,
    outputTokens,
    isTest: false,
    guardianTier: 'basic',
    roomId: null,
    conversationId: null,
  })

  if (lastError || !reply) {
    return NextResponse.json({ error: 'Could not generate a suggestion. Please try again.' })
  }

  return NextResponse.json({ reply })
}
