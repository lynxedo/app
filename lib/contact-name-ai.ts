// lib/contact-name-ai.ts
// Contact Quality Phase 2 — extract a customer's real name from their SMS
// conversation with Claude, for contacts Jobber couldn't name. Deliberately
// CONSERVATIVE: only returns high confidence when the name is clearly the
// customer's own, so an AI-guessed name (marked name_source='ai' → purple dot)
// is rarely wrong. Graceful when no ANTHROPIC_API_KEY (returns null).

import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'

export type NameGuess = { name: string | null; confidence: 'high' | 'low' }

type Msg = { direction: string; body: string | null }

const SYSTEM = `You identify the CUSTOMER's own real personal name from an SMS thread between a lawn-care business ("Us") and a customer ("Customer").
Return ONLY a compact JSON object: {"name": "<their name, or null>", "confidence": "high" | "low"}.
Rules:
- Return a name ONLY when you're genuinely confident it is THIS customer's own name — they introduced themselves ("this is John"), signed a message, or we addressed them by name and they went along with it.
- Use "high" confidence ONLY when it's clearly their name. A third party mentioned in passing ("tell Sarah I said hi"), a business name, a spouse, or any guess → "low".
- Never invent a name. If you can't tell, return {"name": null, "confidence": "low"}.
- Prefer the customer's own self-identification over how we addressed them.`

export async function extractContactName(messages: Msg[]): Promise<NameGuess> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { name: null, confidence: 'low' }

  const transcript = messages
    .filter((m) => (m.body || '').trim())
    .map((m) => `${m.direction === 'inbound' ? 'Customer' : 'Us'}: ${(m.body || '').trim()}`)
    .join('\n')
  if (!transcript.trim()) return { name: null, confidence: 'low' }

  try {
    const anthropic = getAnthropic({ apiKey, timeout: 30_000, maxRetries: 1 })
    const resp = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 100,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Conversation:\n${transcript}\n\nReturn the JSON.` }],
    })
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return { name: null, confidence: 'low' }
    const parsed = JSON.parse(match[0]) as { name?: unknown; confidence?: unknown }
    let name = typeof parsed.name === 'string' ? parsed.name.trim() : null
    // Reject junk: literal "null", no letters, or absurdly long.
    if (name && (name.toLowerCase() === 'null' || !/[a-zA-Z]/.test(name) || name.length > 60)) name = null
    const confidence = parsed.confidence === 'high' ? 'high' : 'low'
    return { name: name || null, confidence: name ? confidence : 'low' }
  } catch (e) {
    console.warn('[contact-name-ai] extract failed', e)
    return { name: null, confidence: 'low' }
  }
}
