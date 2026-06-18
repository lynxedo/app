import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTxtConvPermissions } from '@/lib/txt-permissions'
import { getGuardianModel } from '@/lib/guardian-knowledge'
import { buildGuardianSystem } from '@/lib/guardian-persona'
import { resolveGuardianTier, type GuardianTier } from '@/lib/guardian-permissions'
import { writeAuditLog } from '@/lib/guardian-audit'

// "Polish draft" (Whisper Flow) — Unified Inbox Session 5. Sibling to
// suggest-reply, but fundamentally different: suggest-reply *generates* a reply
// from conversation context; refine-draft *refines the user's own draft*
// (grammar, tone, clarity) WITHOUT replacing their intent or voice. The user
// types or dictates (OS mic key handles speech-to-text natively — we just
// receive a string), hits ✨, and gets a cleaned version of *their* message back.

const MAX_HISTORY_MESSAGES = 6
const MAX_TOKENS = 400
const MAX_DRAFT_CHARS = 2000

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

// Recent history gives tone context only — the model is told to match the
// register, NOT to answer the conversation. Media-only messages collapse to a
// placeholder so we never bloat the prompt with raw URLs.
function formatHistory(rows: MessageRow[]): string {
  return rows
    .map((m) => {
      const body = (m.body || '').trim()
      const hasMedia = Array.isArray(m.media_urls) && m.media_urls.length > 0
      const text = body || (hasMedia ? '(attachment)' : '')
      if (!text) return null
      if (m.direction === 'inbound') return `[Customer] ${text}`
      const sender = unwrapSender(m.sender)
      const first = sender?.display_name?.split(/\s+/)[0] || 'Staff'
      return `[Staff - ${first}] ${text}`
    })
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

// Task-specific layer. Shared identity + voice + the Client Communications guide
// come from buildGuardianSystem({ knowledge: 'customer' }); this only describes
// the polish job. This draft is going to a CUSTOMER, so polish also steers the
// message toward Heroes' policy (see "Steer toward policy" below).
const POLISH_TASK = [
  `Your task: act as an editor and polish Heroes Lawn Care staff's draft SMS reply to a customer before they send it.`,
  ``,
  `Refine the staff member's OWN draft — fix grammar, spelling, punctuation, and capitalization; tighten clarity; smooth tone to be warm and professional. Keep their intent and voice; refine, don't rewrite from scratch.`,
  ``,
  `Steer toward policy: this message is going to a customer, so it must follow the Client Communications guide above. If the draft promises or implies something that conflicts with policy — e.g. offering mowing or landscaping (we don't do those — refer out), quoting a price that should be measured/assessed first, or promising a specific date or time — do NOT polish it as written. Adjust it so it follows policy (refer mowing/landscaping out by name, say we'll measure/assess first, leave scheduling to the team). Staying faithful to the staff member's wording does NOT mean repeating a policy mistake.`,
  ``,
  `Rules:`,
  `- Preserve any correct, on-policy facts, names, dates, prices, or times in the draft. Never invent details that weren't written and aren't in the account info.`,
  `- Keep it SMS-appropriate and concise. Do not add greetings like "Dear..." or sign-offs unless the draft already had one.`,
  `- Use the conversation history for tone/register only — do NOT answer the conversation, only polish the given draft.`,
  `- If the draft is already clean and on-policy, return it essentially unchanged.`,
  `- Do NOT mention that you are an AI. Do NOT add commentary, quotes, or prefixes.`,
  `- Return ONLY the polished SMS body.`,
].join('\n')

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

  // ---- Gate: canReply (this is a composer action on the user's own draft) ----
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
  if (!profile || !profile.company_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const companyId = profile.company_id

  // ---- Draft parsing ----
  const body = await request.json().catch(() => ({}))
  const rawDraft = typeof body.draft_text === 'string' ? body.draft_text : ''
  const draft = rawDraft.trim().slice(0, MAX_DRAFT_CHARS)
  if (!draft) {
    return NextResponse.json({ error: 'Nothing to polish — type a draft first.' })
  }

  // ---- Anthropic key check (graceful, not 500) ----
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Guardian not configured' })
  }

  const adminClient = createAdminClient()

  const [messagesRes, model, tier] = await Promise.all([
    supabase
      .from('txt_messages')
      .select(
        'direction, body, media_urls, created_at, sender:hub_users!sent_by ( display_name )'
      )
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORY_MESSAGES),
    getGuardianModel(adminClient, companyId).catch(() => CLAUDE_MODEL),
    resolveGuardianTier(supabase, user.id, { conversationId }).catch<GuardianTier>(
      () => 'basic'
    ),
  ])

  const messages = ((messagesRes.data || []) as MessageRow[]).reverse() // chronological
  const historyText = formatHistory(messages)

  const system = await buildGuardianSystem({
    companyId,
    knowledge: 'customer',
    task: POLISH_TASK,
    admin: adminClient,
  })

  const userMessage = [
    historyText
      ? `Recent conversation (for tone/register only — do not answer it):\n${historyText}`
      : `(No prior messages — polish on its own merits.)`,
    ``,
    `---`,
    `Polish this draft and return only the cleaned-up SMS body:`,
    draft,
  ].join('\n')

  // ---- Call Anthropic. Direct, no tools, no agentic loop. ----
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
    console.error('[refine-draft] Anthropic call failed:', lastError)
  }

  // ---- Audit log (fire-and-forget) ----
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
    guardianTier: tier,
    roomId: null,
    conversationId,
  })

  if (lastError || !refined) {
    return NextResponse.json({
      error: 'Could not polish the draft. Please try again.',
    })
  }

  return NextResponse.json({ refined })
}
