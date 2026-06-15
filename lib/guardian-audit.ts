import type { SupabaseClient } from '@supabase/supabase-js'

export interface AuditEntry {
  companyId: string
  userId?: string | null
  question: string
  answer?: string | null
  model?: string | null
  toolsCalled: string[]
  webSearchesUsed: number
  inputTokens?: number | null
  outputTokens?: number | null
  isTest: boolean
  guardianTier?: string | null
  roomId?: string | null
  conversationId?: string | null
}

/**
 * Fire-and-forget audit log writer. Never await — a slow DB write must NOT block
 * the Guardian response.
 */
export function writeAuditLog(adminClient: SupabaseClient, entry: AuditEntry): void {
  void adminClient
    .from('guardian_audit')
    .insert({
      company_id: entry.companyId,
      user_id: entry.userId ?? null,
      question: entry.question,
      answer: entry.answer ?? null,
      model: entry.model ?? null,
      tools_called: entry.toolsCalled,
      web_searches_used: entry.webSearchesUsed,
      input_tokens: entry.inputTokens ?? null,
      output_tokens: entry.outputTokens ?? null,
      is_test: entry.isTest,
      guardian_tier: entry.guardianTier ?? null,
      room_id: entry.roomId ?? null,
      conversation_id: entry.conversationId ?? null,
    })
    .then(({ error }) => {
      if (error) console.error('[guardian:audit]', error.message)
    })
}

/**
 * Atomically increment today's web search counter for a company and return the
 * new count.
 *
 * AI7 (audit) — this used to be a read-modify-write (INSERT, then on conflict
 * SELECT current + UPDATE current+delta). Two Guardian requests racing on the
 * same day could both read the same `current` and write the same `current+1`,
 * silently losing an increment. It now calls the `increment_web_search_usage`
 * Postgres function, which does `INSERT ... ON CONFLICT DO UPDATE SET count =
 * count + EXCLUDED.count RETURNING count` — a single atomic statement, no race.
 *
 * Pass `delta` = number of new searches to record. Anthropic reports searches
 * server-side in batches per API call (response.usage.server_tool_use.web_search_requests),
 * so we typically pass the iteration's delta.
 */
export async function incrementWebSearchUsage(
  adminClient: SupabaseClient,
  companyId: string,
  delta: number
): Promise<number> {
  if (delta <= 0) return await getTodayWebSearchCount(adminClient, companyId)

  const today = new Date().toISOString().slice(0, 10)

  const { data, error } = await adminClient.rpc('increment_web_search_usage', {
    p_company_id: companyId,
    p_date: today,
    p_delta: delta,
  })

  if (error) {
    console.error('[guardian:web-search-usage]', error.message)
    // Best-effort fallback so the caller still gets a sane number.
    return await getTodayWebSearchCount(adminClient, companyId)
  }
  return (data as number | null) ?? 0
}

/**
 * Returns today's web search count for the company (0 if no row exists yet).
 */
export async function getTodayWebSearchCount(
  adminClient: SupabaseClient,
  companyId: string
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await adminClient
    .from('guardian_web_search_usage')
    .select('count')
    .eq('company_id', companyId)
    .eq('date', today)
    .maybeSingle()
  return (data as { count: number } | null)?.count ?? 0
}
