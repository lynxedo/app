// Assistant conversation memory — what the assistant DID, carried between turns.
//
// Guardian starts each reply from an empty `messages` array; the conversation is
// re-injected as plain text in the system prompt, built from visible room
// messages. That gives the model what was SAID but nothing about what it DID:
// its own tool calls and their results were thrown away at the end of every
// turn. So it re-ran lookups it had already done, and anything that lived only
// in a tool result — the confirmation short_id above all — was simply gone by
// the time the person replied "yes".
//
// Two modes, chosen per company (Admin → AI → Assistant):
//
//   light — a short note: which tools ran, the first line of each result, and any
//           record ids. A few hundred tokens. Fixes the confirmation loop and
//           most of the re-fetching. The assistant remembers THAT it looked
//           something up and WHICH record, not the detail of what came back.
//   full  — the actual message blocks replayed into the request. Costs real
//           tokens per turn, and is what you want for a long multi-step job.
//
// ⚠ Both are WRITTEN every turn whatever the mode; the mode only decides what is
// READ BACK. Switching a company to 'full' mid-project therefore works
// retroactively rather than starting from blank.

import type Anthropic from '@anthropic-ai/sdk'
import type { Admin } from './types'

export type MemoryMode = 'off' | 'light' | 'full'

/** How many past turns to replay. Full is tighter — each turn is far larger. */
const REPLAY_TURNS_LIGHT = 8
const REPLAY_TURNS_FULL = 6

/**
 * Ceiling on replayed transcript. Turns are dropped OLDEST-FIRST and only ever
 * whole: a half-replayed turn could sever a tool_use from its tool_result, which
 * the API rejects outright.
 */
const MAX_REPLAY_CHARS = 60_000

/** Longest single tool result kept. A 200-row query result is not worth carrying. */
const MAX_RESULT_CHARS = 4_000

/** Turns kept per conversation before older ones are pruned. */
const RETAIN_TURNS = 20

/** First line of a result, flattened — usually the part a human would read. */
function headline(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`
}

function clipResult(text: string): string {
  return text.length <= MAX_RESULT_CHARS ? text : `${text.slice(0, MAX_RESULT_CHARS)}… (truncated in memory)`
}

/**
 * Record identifiers worth carrying forward even when the headline misses them.
 * The confirmation id is the reason this function exists: it appears only in a
 * staging tool result, several lines down, and losing it is what made "yes"
 * unanswerable.
 */
function extractIds(text: string): string[] {
  const found: string[] = []
  const confirm = /confirm_action with id="([A-Z0-9]{4,12})"/.exec(text)
  if (confirm) found.push(`confirmation id ${confirm[1]} (staged, NOT yet confirmed)`)
  const jobNo = /#(\d{2,6})\b/.exec(text)
  if (jobNo) found.push(`job #${jobNo[1]}`)
  const encoded = text.match(/\bZ2lkOi8v[A-Za-z0-9+/=]{8,}/g)
  if (encoded) {
    for (const id of [...new Set(encoded)].slice(0, 3)) found.push(id)
  }
  return found
}

/** Text of a tool_result block, whatever shape the content arrived in. */
function resultText(block: Anthropic.ToolResultBlockParam): string {
  const c = block.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/** The conversation this turn belongs to, or null when there's nothing to key on. */
export function memoryScopeKey(opts: {
  roomId?: string | null
  conversationId?: string | null
  userId?: string | null
}): string | null {
  if (opts.roomId) return `room:${opts.roomId}`
  if (opts.conversationId) return `conv:${opts.conversationId}`
  if (opts.userId) return `dm:${opts.userId}`
  return null
}

/**
 * Walk a completed turn and write down what happened, pairing each tool_use with
 * its result by id rather than by position — the results come back from a
 * Promise.all and must not be assumed to be in call order.
 */
export function summariseTurn(messages: Anthropic.MessageParam[], finalAnswer: string): string {
  const resultById = new Map<string, string>()
  for (const m of messages) {
    if (m.role !== 'user' || !Array.isArray(m.content)) continue
    for (const b of m.content as Anthropic.ContentBlockParam[]) {
      if (b.type === 'tool_result') {
        resultById.set(b.tool_use_id, resultText(b as Anthropic.ToolResultBlockParam))
      }
    }
  }

  const lines: string[] = []
  for (const m of messages) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue
    for (const b of m.content as Anthropic.ContentBlockParam[]) {
      if (b.type !== 'tool_use') continue
      const raw = resultById.get(b.id) ?? ''
      const ids = extractIds(raw)
      lines.push(
        `- ${b.name} → ${headline(raw) || 'no result recorded'}` +
          (ids.length ? `\n    [${ids.join(' · ')}]` : ''),
      )
    }
  }

  if (lines.length === 0 && !finalAnswer) return ''
  return [
    lines.length ? lines.join('\n') : '- (no tools used)',
    finalAnswer ? `  You replied: ${headline(finalAnswer, 300)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * The blocks to persist for full replay: the turn as it actually ran, plus the
 * final answer (which the loop returns directly and never pushes onto
 * `messages`). Returns null when the shape isn't safely replayable.
 */
export function buildReplayBlocks(
  messages: Anthropic.MessageParam[],
  finalAnswer: string,
): Anthropic.MessageParam[] | null {
  if (messages.length === 0 || messages[0].role !== 'user') return null

  const out: Anthropic.MessageParam[] = messages.map((m) => {
    if (m.role !== 'user' || !Array.isArray(m.content)) return m
    return {
      role: 'user',
      content: (m.content as Anthropic.ContentBlockParam[]).map((b) =>
        b.type === 'tool_result'
          ? { ...b, content: clipResult(resultText(b as Anthropic.ToolResultBlockParam)) }
          : b,
      ),
    }
  })

  // Every replayed turn must END on an assistant message, so that concatenating
  // turns yields a valid alternating transcript and the next turn's user message
  // doesn't land next to another user message.
  const answer = finalAnswer.trim() || '(no reply recorded)'
  out.push({ role: 'assistant', content: [{ type: 'text', text: answer }] })
  return out
}

/** Persist one completed turn. Fire-and-forget: memory must never fail a reply. */
export function saveTurnMemory(
  admin: Admin,
  entry: {
    companyId: string
    scopeKey: string | null
    userId?: string | null
    messages: Anthropic.MessageParam[]
    finalAnswer: string
  },
): void {
  if (!entry.scopeKey) return
  const summary = summariseTurn(entry.messages, entry.finalAnswer)
  const blocks = buildReplayBlocks(entry.messages, entry.finalAnswer)
  if (!summary && !blocks) return

  void admin
    .from('hub_assistant_turn_memory')
    .insert({
      company_id: entry.companyId,
      scope_key: entry.scopeKey,
      user_id: entry.userId ?? null,
      summary,
      blocks: blocks ?? [],
    })
    .then(
      () => pruneScope(admin, entry.companyId, entry.scopeKey as string),
      () => {},
    )
}

/** Keep the newest RETAIN_TURNS rows per conversation; drop the rest. */
function pruneScope(admin: Admin, companyId: string, scopeKey: string): void {
  void admin
    .from('hub_assistant_turn_memory')
    .select('id')
    .eq('company_id', companyId)
    .eq('scope_key', scopeKey)
    .order('created_at', { ascending: false })
    .range(RETAIN_TURNS, RETAIN_TURNS + 199)
    .then(({ data }) => {
      const stale = ((data || []) as Array<{ id: string }>).map((r) => r.id)
      if (stale.length === 0) return
      void admin.from('hub_assistant_turn_memory').delete().in('id', stale).then(undefined, () => {})
    }, () => {})
}

export type LoadedMemory = {
  /** Light mode: a note to append to the system prompt. */
  note: string
  /** Full mode: prior turns to replay ahead of the new user message. */
  replay: Anthropic.MessageParam[]
}

const EMPTY: LoadedMemory = { note: '', replay: [] }

/**
 * Read back what this conversation already did. Never throws — an assistant that
 * refuses to answer because it couldn't remember is worse than a forgetful one.
 */
export async function loadTurnMemory(
  admin: Admin,
  opts: { companyId: string; scopeKey: string | null; mode: MemoryMode },
): Promise<LoadedMemory> {
  if (!opts.scopeKey || opts.mode === 'off') return EMPTY

  try {
    const limit = opts.mode === 'full' ? REPLAY_TURNS_FULL : REPLAY_TURNS_LIGHT
    const { data } = await admin
      .from('hub_assistant_turn_memory')
      .select('summary, blocks, created_at')
      .eq('company_id', opts.companyId)
      .eq('scope_key', opts.scopeKey)
      .order('created_at', { ascending: false })
      .limit(limit)

    const rows = (data || []) as Array<{ summary: string | null; blocks: unknown }>
    if (rows.length === 0) return EMPTY
    // Newest-first from the query; replay wants oldest-first.
    rows.reverse()

    if (opts.mode === 'light') {
      const note = rows
        .map((r) => (r.summary || '').trim())
        .filter(Boolean)
        .join('\n')
      if (!note) return EMPTY
      return {
        note:
          '\n\nWhat you already did earlier in this conversation (most recent last). ' +
          'These calls have ALREADY run — do not repeat them, and do not tell the user you are ' +
          'doing them again. If a confirmation id is listed as staged, that preview is still ' +
          'waiting: when the user agrees, call confirm_action with that id rather than staging a ' +
          'new one. Call a tool again only if you need detail this note does not carry.\n' +
          note,
        replay: [],
      }
    }

    // Full: replay whole turns, newest kept, dropping from the oldest end until
    // the transcript fits. Partial turns are never emitted — cutting between a
    // tool_use and its tool_result makes the request invalid.
    const turns: Anthropic.MessageParam[][] = rows
      .map((r) => (Array.isArray(r.blocks) ? (r.blocks as Anthropic.MessageParam[]) : []))
      .filter((t) => t.length > 0 && t[0]?.role === 'user' && t[t.length - 1]?.role === 'assistant')

    const kept: Anthropic.MessageParam[][] = []
    let chars = 0
    for (let i = turns.length - 1; i >= 0; i--) {
      const size = JSON.stringify(turns[i]).length
      if (chars + size > MAX_REPLAY_CHARS && kept.length > 0) break
      kept.unshift(turns[i])
      chars += size
    }
    if (kept.length === 0) return EMPTY
    return { note: '', replay: kept.flat() }
  } catch {
    return EMPTY
  }
}
