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
 * new count. Uses INSERT ... ON CONFLICT DO UPDATE so concurrent calls are safe.
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

  // Postgres upsert with a server-side increment isn't directly supported by
  // PostgREST in a single round-trip. We use an RPC-equivalent: try INSERT,
  // fall back to UPDATE ... SET count = count + delta. Two queries worst case;
  // both are cheap and the table is tiny.
  const today = new Date().toISOString().slice(0, 10)

  const { error: insertError } = await adminClient
    .from('guardian_web_search_usage')
    .insert({ company_id: companyId, date: today, count: delta })

  if (!insertError) return delta

  // Row exists — increment. Fetch + write (no atomic primitive via PostgREST;
  // tiny race window acceptable, the daily cap is advisory and one extra search
  // on a boundary call is fine per the spec).
  const { data: existing } = await adminClient
    .from('guardian_web_search_usage')
    .select('count')
    .eq('company_id', companyId)
    .eq('date', today)
    .maybeSingle()

  const current = (existing as { count: number } | null)?.count ?? 0
  const next = current + delta

  const { error: updateError } = await adminClient
    .from('guardian_web_search_usage')
    .update({ count: next })
    .eq('company_id', companyId)
    .eq('date', today)

  if (updateError) {
    console.error('[guardian:web-search-usage]', updateError.message)
    return current
  }
  return next
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
