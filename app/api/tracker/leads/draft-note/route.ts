import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import { createClient } from '@/lib/supabase/server'

// POST /api/tracker/leads/draft-note   Body: { conversation_id }  → { note }
//
// Suggests a short, lead-oriented summary of a Txt conversation to pre-fill the
// first note when adding that conversation to the Lead Tracker. This exists ONLY
// for texts — call summaries are already computed at transcription time and are
// used directly on the client. Best-effort: returns { note: '' } on any failure
// (no key, no messages, model error) so the modal just falls back to a blank,
// editable note.
//
// Gated on can_access_tracker (or admin), matching the from-source create route.

const MAX_MESSAGES = 40
const MAX_TOKENS = 220

const SYSTEM = [
  'You summarize a text-message conversation between a lawn-care company and a prospective customer, for a sales rep filing this person as a new lead.',
  '',
  'Write 2–3 short, plain sentences capturing:',
  '- What the customer wants or asked about.',
  '- Any address, property details, or specific services mentioned.',
  '- Anything still OPEN (a quote to send, a callback owed, a decision pending).',
  '',
  'Rules: only use facts present in the messages — never invent prices, dates, or commitments. No greeting, no preamble, no bullet points, no "Here is a summary". Just the sentences. Do not mention that you are an AI.',
].join('\n')

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_access_tracker')
    .eq('id', user.id)
    .single()
  const allowed = profile?.role === 'admin' || profile?.can_access_tracker === true
  if (!allowed || !profile?.company_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const conversationId = typeof body.conversation_id === 'string' ? body.conversation_id : ''
  if (!conversationId) return NextResponse.json({ note: '' })

  // RLS scopes this to the caller's company.
  const { data: rows } = await supabase
    .from('txt_messages')
    .select('direction, body, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  const msgs = (rows ?? []) as { direction: string; body: string | null }[]
  const digest = msgs
    .filter((m) => (m.body || '').trim())
    .slice(-MAX_MESSAGES)
    .map((m) => `${m.direction === 'inbound' ? 'Customer' : 'Staff'}: ${(m.body || '').trim()}`)
    .join('\n')

  if (!digest.trim()) return NextResponse.json({ note: '' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ note: '' })

  try {
    const anthropic = getAnthropic({ apiKey, timeout: 30_000, maxRetries: 1 })
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Text conversation (oldest to newest):\n${digest}\n\n---\nSummarize this prospect for a lead note in 2–3 sentences.`,
        },
      ],
    })
    const note = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    return NextResponse.json({ note })
  } catch (e) {
    console.error('[draft-note] Anthropic call failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ note: '' })
  }
}
