// AI Type-tag suggester for the Shared Inbox. Given a newly-arrived email, it picks
// the single best-matching company "Type" tag (inbox_tags.kind='type') — or none —
// using Claude, reusing the Guardian persona/model plumbing so the classification
// reads the company's own identity/knowledge.
//
// Best-effort by CONTRACT: this runs INSIDE the inbound-mail sync path, so it must
// NEVER throw. Every failure mode — Anthropic not configured, no Type tags, API
// error, an unparseable answer, or a name that doesn't map back to a tag — resolves
// to null and the caller simply skips auto-tagging.

import type { SupabaseClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import { getGuardianModel } from '@/lib/guardian-knowledge'
import { buildGuardianSystem } from '@/lib/guardian-persona'

const MAX_BODY_CHARS = 1500
const MAX_TOKENS = 32 // one short tag name (or "NONE") — keep the call cheap

type TypeTag = { id: string; name: string }

export async function suggestTypeTagId(
  admin: SupabaseClient,
  opts: {
    companyId: string
    subject: string | null
    bodyText: string | null
    fromEmail: string | null
  }
): Promise<string | null> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return null

    // Load the company's ACTIVE Type tags.
    const { data, error } = await admin
      .from('inbox_tags')
      .select('id, name')
      .eq('company_id', opts.companyId)
      .eq('kind', 'type')
      .eq('active', true)
      .order('sort_order', { ascending: true })
    if (error) return null
    const tags = ((data ?? []) as TypeTag[]).filter(
      (t) => t && typeof t.id === 'string' && typeof t.name === 'string' && t.name.trim()
    )
    if (tags.length === 0) return null

    const model = await getGuardianModel(admin, opts.companyId).catch(() => CLAUDE_MODEL)

    const tagNames = tags.map((t) => t.name.trim())
    const task = [
      `Your task: classify an incoming customer email by choosing the single best-matching "Type" tag from the list below, or NONE if none of them clearly fit.`,
      ``,
      `Available Type tags (choose exactly one, or NONE):`,
      ...tagNames.map((n) => `- ${n}`),
      ``,
      `Rules:`,
      `- Reply with EXACTLY one tag name, copied verbatim from the list above, OR the single word NONE.`,
      `- No punctuation, quotes, labels, explanation, or extra text — just the tag name (or NONE).`,
      `- If you are not confident the email clearly matches one of the tags, reply NONE.`,
    ].join('\n')

    const system = await buildGuardianSystem({
      companyId: opts.companyId,
      knowledge: 'customer',
      surface: 'guardian',
      task,
      admin,
    })

    const from = (opts.fromEmail || '').trim()
    const subject = (opts.subject || '').trim()
    const bodyRaw = (opts.bodyText || '').trim()
    const body = bodyRaw.length > MAX_BODY_CHARS ? bodyRaw.slice(0, MAX_BODY_CHARS) + '\n…(truncated)' : bodyRaw
    const userMessage = [
      from ? `From: ${from}` : null,
      subject ? `Subject: ${subject}` : null,
      ``,
      body || '(no body)',
      ``,
      `---`,
      `Which Type tag best fits this email? Reply with one tag name from the list, or NONE.`,
    ]
      .filter((l): l is string => l !== null)
      .join('\n')

    const anthropic = getAnthropic({ apiKey, timeout: 60_000, maxRetries: 1 })
    const response = await anthropic.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: userMessage }],
    })
    const answer = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    if (!answer) return null

    // Strip any stray quotes / trailing punctuation the model may add.
    const normalized = answer.toLowerCase().replace(/^["'`\s]+/, '').replace(/["'`.\s]+$/, '')
    if (!normalized || normalized === 'none') return null

    // Map the returned name back to its tag id (case-insensitive exact match).
    // Anything that doesn't match a real tag name → null (low confidence / drift).
    const match = tags.find((t) => t.name.trim().toLowerCase() === normalized)
    return match ? match.id : null
  } catch (err) {
    console.warn('[inbox:tag-suggest] suggestTypeTagId failed:', err)
    return null
  }
}
