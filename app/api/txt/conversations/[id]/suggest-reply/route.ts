import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTxtConvPermissions } from '@/lib/txt-permissions'
import {
  getGuardianModel,
  getKnowledgeDoc,
} from '@/lib/guardian-knowledge'
import { resolveGuardianTier, type GuardianTier } from '@/lib/guardian-permissions'
import { writeAuditLog } from '@/lib/guardian-audit'
import { callHeroesTool } from '@/lib/hub-claude'

type Tone = 'professional' | 'friendly' | 'brief'
const ALLOWED_TONES: Tone[] = ['professional', 'friendly', 'brief']

const MAX_HISTORY_MESSAGES = 10
const MAX_TOKENS = 300
const JOBBER_FETCH_TIMEOUT_MS = 10_000

type MessageRow = {
  direction: 'inbound' | 'outbound'
  body: string | null
  media_urls: string[] | null
  created_at: string
  sender?: { display_name: string | null } | { display_name: string | null }[] | null
}

function unwrapSender(
  s: MessageRow['sender']
): { display_name: string | null } | null {
  if (!s) return null
  return Array.isArray(s) ? s[0] || null : s
}

// Format the last N messages in chronological order with clear [Customer] /
// [Staff - First] labels. Media-only messages (empty body) get a "(attachment)"
// placeholder so Guardian still knows something happened, without bloating the
// prompt with raw media URLs.
function formatHistory(rows: MessageRow[]): string {
  return rows
    .map((m) => {
      const body = (m.body || '').trim()
      const hasMedia = Array.isArray(m.media_urls) && m.media_urls.length > 0
      const text = body || (hasMedia ? '(attachment)' : '')
      if (!text) return null
      if (m.direction === 'inbound') return `[Customer] ${text}`
      const sender = unwrapSender(m.sender)
      const first =
        sender?.display_name?.split(/\s+/)[0] || 'Staff'
      return `[Staff - ${first}] ${text}`
    })
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

// Best-effort Jobber lookup. Returns a short summary string for the system
// prompt, or null on any failure (timeout, no client_id, MCP down). Never
// throws — suggest-reply must keep working even when Jobber is unreachable.
async function fetchJobberSummary(jobberClientId: string): Promise<string | null> {
  try {
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), JOBBER_FETCH_TIMEOUT_MS)
    )
    const fetchPromise = callHeroesTool('get_client_details', {
      client_id: jobberClientId,
    })
    const result = await Promise.race([fetchPromise, timeoutPromise])
    if (!result || typeof result !== 'string') return null
    if (result.startsWith('Error calling')) return null
    // get_client_details returns a fairly compact text block already. Cap to
    // ~2000 chars so a verbose response can't blow up the system prompt.
    return result.length > 2000 ? result.slice(0, 2000) + '\n…(truncated)' : result
  } catch {
    return null
  }
}

function buildSystemPrompt(opts: {
  tone: Tone
  customerServiceBody: string | null
  jobberSummary: string | null
}): string {
  const sections: string[] = [
    `You are a helpful assistant for Heroes Lawn Care staff composing SMS replies to customers.`,
  ]

  if (opts.customerServiceBody) {
    sections.push(
      `COMPANY KNOWLEDGE — Customer Service Standards & Templates:\n${opts.customerServiceBody}`
    )
  }

  sections.push(
    `CUSTOMER ACCOUNT (from Jobber):\n${opts.jobberSummary || 'No Jobber record found for this contact.'}`
  )

  sections.push(
    [
      `Your task: suggest a single, natural SMS reply that staff can send as-is or lightly edit.`,
      `Tone: ${opts.tone}`,
      `Rules:`,
      `- Write as a Heroes Lawn Care staff member, not as an AI`,
      `- Match the tone of the conversation history`,
      `- Keep it concise (SMS appropriate — aim for 1–3 sentences)`,
      `- Do NOT include a subject line or greeting like "Dear..."`,
      `- Do NOT mention that you are an AI`,
      `- Use the templates in the customer service doc as style guides, not copy-paste templates`,
      `- If you reference a specific date or price, only do so if it appears in the account info provided`,
      `- Return ONLY the SMS body. No prefixes, no quotes, no commentary.`,
    ].join('\n')
  )

  return sections.join('\n\n')
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: conversationId } = await params

  // ---- Dual gate: canReply AND any guardian_tier ----
  const [permissions, profileRes] = await Promise.all([
    getTxtConvPermissions(supabase, conversationId, user.id),
    supabase
      .from('user_profiles')
      .select('guardian_tier, company_id')
      .eq('id', user.id)
      .maybeSingle(),
  ])

  if (!permissions.canReply) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const profile = profileRes.data as {
    guardian_tier: GuardianTier | null
    company_id: string | null
  } | null

  // Spec: "if null/missing treat as 'basic' which still passes" — but if the
  // user has no profile row at all we can't audit-log anyway, so 403.
  if (!profile || !profile.company_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const companyId = profile.company_id

  // ---- Tone parsing ----
  const body = await request.json().catch(() => ({}))
  const requestedTone = typeof body.tone === 'string' ? body.tone.toLowerCase() : ''
  const tone: Tone = (ALLOWED_TONES as string[]).includes(requestedTone)
    ? (requestedTone as Tone)
    : 'professional'

  // ---- Anthropic key check (graceful, not 500) ----
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Guardian not configured' })
  }

  // ---- Smart context: conversation history + contact + customer_service doc + Jobber ----
  const adminClient = createAdminClient()

  const [messagesRes, convRes, customerServiceDoc, model, tier] = await Promise.all([
    supabase
      .from('txt_messages')
      .select(
        'direction, body, media_urls, created_at, sender:hub_users!sent_by ( display_name )'
      )
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORY_MESSAGES),
    supabase
      .from('txt_conversations')
      .select(
        `contact:txt_contacts!txt_conversations_contact_id_fkey ( id, jobber_client_id )`
      )
      .eq('id', conversationId)
      .maybeSingle(),
    getKnowledgeDoc(adminClient, companyId, 'customer_service').catch(() => null),
    getGuardianModel(adminClient, companyId).catch(() => CLAUDE_MODEL),
    resolveGuardianTier(supabase, user.id, { conversationId }).catch<GuardianTier>(
      () => 'basic'
    ),
  ])

  const messages = ((messagesRes.data || []) as MessageRow[]).reverse() // chronological
  if (messages.length === 0) {
    return NextResponse.json({
      error: 'Nothing to reply to — this conversation is empty.',
    })
  }

  const contactRow = convRes.data as
    | { contact: { jobber_client_id: string | null } | { jobber_client_id: string | null }[] | null }
    | null
  const contact = contactRow?.contact
    ? Array.isArray(contactRow.contact)
      ? contactRow.contact[0]
      : contactRow.contact
    : null
  const jobberClientId = contact?.jobber_client_id || null

  const jobberSummary = jobberClientId
    ? await fetchJobberSummary(jobberClientId)
    : null

  const systemPrompt = buildSystemPrompt({
    tone,
    customerServiceBody: customerServiceDoc?.body || null,
    jobberSummary,
  })

  const historyText = formatHistory(messages)
  const userMessage = `Conversation history:\n${historyText}\n\n---\nSuggest a ${tone} SMS reply to the most recent customer message.`

  // ---- Call Anthropic. Direct, no tools, no agentic loop. ----
  let suggestion = ''
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
    suggestion = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    inputTokens = response.usage?.input_tokens ?? null
    outputTokens = response.usage?.output_tokens ?? null
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e)
    console.error('[suggest-reply] Anthropic call failed:', lastError)
  }

  // ---- Audit log (fire-and-forget) ----
  writeAuditLog(adminClient, {
    companyId,
    userId: user.id,
    question: userMessage,
    answer: suggestion || null,
    model,
    toolsCalled: jobberSummary ? ['get_client_details'] : [],
    webSearchesUsed: 0,
    inputTokens,
    outputTokens,
    isTest: false,
    guardianTier: tier,
    roomId: null,
    conversationId,
  })

  if (lastError || !suggestion) {
    return NextResponse.json({
      error: 'Could not generate a suggestion. Please try again.',
    })
  }

  return NextResponse.json({ suggestion, tone })
}
