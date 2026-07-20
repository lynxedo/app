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

// "Polish draft" for email — refines the staff member's OWN draft (grammar, tone,
// clarity, policy) without answering the conversation or replacing their voice.
// Mirrors the Txt refine-draft, adapted to the email thread.

const MAX_HISTORY_MESSAGES = 6
const MAX_TOKENS = 800
const MAX_DRAFT_CHARS = 6000
const MAX_MSG_CHARS = 1200

type MessageRow = {
  direction: 'inbound' | 'outbound'
  body_text: string | null
  body_html: string | null
  snippet: string | null
  from_name: string | null
  sent_by_user_id: string | null
  message_date: string | null
}

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

function formatHistory(rows: MessageRow[], staffNames: Record<string, string>): string {
  return rows
    .map((m) => {
      const text = messageText(m)
      if (!text) return null
      if (m.direction === 'inbound') return `[Customer] ${text}`
      const name = (m.sent_by_user_id && staffNames[m.sent_by_user_id]) || m.from_name || 'Staff'
      return `[Staff - ${name.split(/\s+/)[0]}] ${text}`
    })
    .filter((line): line is string => Boolean(line))
    .join('\n\n')
}

const POLISH_TASK = [
  `Your task: act as an editor and polish Heroes Lawn Care staff's draft EMAIL reply to a customer before they send it.`,
  ``,
  `Refine the staff member's OWN draft — fix grammar, spelling, punctuation, and capitalization; tighten clarity; smooth tone to be warm and professional. Keep their intent and voice; refine, don't rewrite from scratch.`,
  ``,
  `Steer toward policy: this message is going to a customer, so it must follow the Client Communications guide above. If the draft promises or implies something that conflicts with policy — e.g. offering services we don't do (refer out), quoting a price that should be measured/assessed first, or promising a specific date or time — adjust it so it follows policy rather than repeating the mistake.`,
  ``,
  `Rules:`,
  `- Preserve any correct, on-policy facts, names, dates, prices, or times in the draft. Never invent details that weren't written and aren't in the account info.`,
  `- Email-appropriate. Do NOT add a sign-off signature block — the app appends the sender's signature automatically. Do NOT invent a subject line.`,
  `- Use the conversation history for tone/register only — do NOT answer the conversation, only polish the given draft.`,
  `- If the draft is already clean and on-policy, return it essentially unchanged.`,
  `- Do NOT mention that you are an AI. Do NOT add commentary, quotes, or prefixes.`,
  `- Return ONLY the polished email body text.`,
].join('\n')

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
  const rawDraft = typeof body.draft === 'string' ? body.draft : ''
  const draft = rawDraft.trim().slice(0, MAX_DRAFT_CHARS)
  if (!draft) return NextResponse.json({ error: 'Nothing to polish — type a draft first.' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Guardian not configured' })

  const admin = createAdminClient()

  const [messagesRes, model] = await Promise.all([
    supabase
      .from('inbox_messages')
      .select('direction, body_text, body_html, snippet, from_name, sent_by_user_id, message_date')
      .eq('thread_id', id)
      .order('message_date', { ascending: false })
      .limit(MAX_HISTORY_MESSAGES),
    getGuardianModel(admin, companyId).catch(() => CLAUDE_MODEL),
  ])

  const messages = ((messagesRes.data || []) as MessageRow[]).reverse() // chronological

  const staffIds = [...new Set(messages.map((m) => m.sent_by_user_id).filter((x): x is string => !!x))]
  const staffNames: Record<string, string> = {}
  if (staffIds.length > 0) {
    const { data: hus } = await admin.from('hub_users').select('id, display_name').in('id', staffIds)
    for (const h of (hus ?? []) as { id: string; display_name: string | null }[]) {
      if (h.display_name) staffNames[h.id] = h.display_name
    }
  }

  const historyText = formatHistory(messages, staffNames)

  const system = await buildGuardianSystem({
    companyId,
    knowledge: 'customer',
    surface: 'guardian',
    task: POLISH_TASK,
    admin,
  })

  const userMessage = [
    historyText
      ? `Recent conversation (for tone/register only — do not answer it):\n${historyText}`
      : `(No prior messages — polish on its own merits.)`,
    ``,
    `---`,
    `Polish this draft and return only the cleaned-up email body:`,
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
      system,
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
    console.error('[inbox:refine-draft] Anthropic call failed:', lastError)
  }

  writeAuditLog(admin, {
    companyId,
    userId,
    question: userMessage,
    answer: refined || null,
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

  if (lastError || !refined) {
    return NextResponse.json({ error: 'Could not polish the draft. Please try again.' })
  }

  return NextResponse.json({ refined })
}
