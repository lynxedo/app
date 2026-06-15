import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  estimateTokens,
  getAlwaysIncludedDocs,
  getGuardianSettings,
  resolveReadKnowledgeDoc,
} from '@/lib/guardian-knowledge'
import { getMcpToolFilter, type GuardianTier } from '@/lib/guardian-permissions'
import {
  getTodayWebSearchCount,
  incrementWebSearchUsage,
  writeAuditLog,
} from '@/lib/guardian-audit'

const MCP_URL = 'https://mcp.lynxedo.com/mcp'
const MAX_TOOL_ITERATIONS = 6
const TOOLS_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
const PROMPT_CACHE_MIN_TOKENS = 1024 // Anthropic's activation floor
const WEB_SEARCH_TOOL_TYPE = 'web_search_20250305'
const PER_QUESTION_SEARCH_BUDGET = 3

// ---------------------------------------------------------------------------
// MCP transport
// ---------------------------------------------------------------------------

async function mcpRequest(method: string, params: unknown = {}): Promise<unknown> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    signal: AbortSignal.timeout(10000),
  })

  const contentType = res.headers.get('content-type') ?? ''

  if (contentType.includes('text/event-stream')) {
    const text = await res.text()
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue
      try {
        const data = JSON.parse(line.slice(6))
        if (data.error) throw new Error(data.error.message)
        if (data.result !== undefined) return data.result
      } catch (e) {
        if (e instanceof Error && e.message !== 'Unexpected token') throw e
      }
    }
    return null
  }

  const data = await res.json() as { result?: unknown; error?: { message: string } }
  if (data.error) throw new Error(data.error.message)
  return data.result
}

// ---------------------------------------------------------------------------
// Tool list caching (module-level, 1h TTL)
// ---------------------------------------------------------------------------

// AI10 — this cache is PER PROCESS (per PM2 cluster worker / per serverless
// instance), NOT shared across the fleet. That's intentional: the MCP tool
// list rarely changes and a 1h-stale list per worker is harmless. Do NOT
// "fix" this by moving it behind a request-scoped client or recreating the
// module on each call — that would re-fetch tools/list on every Guardian
// question and bust the byte-stable tools prefix (see AI6 below). Admin
// "refresh tools" calls bustToolsCache() to force a re-fetch when needed.
let _toolsCache: { tools: Anthropic.Tool[]; fetchedAt: number } | null = null

export async function getHeroesTools(): Promise<Anthropic.Tool[]> {
  if (_toolsCache && Date.now() - _toolsCache.fetchedAt < TOOLS_CACHE_TTL_MS) {
    return _toolsCache.tools
  }
  try {
    const result = await mcpRequest('tools/list') as { tools?: Array<{ name: string; description?: string; inputSchema: Anthropic.Tool['input_schema'] }> } | null
    const tools: Anthropic.Tool[] = (result?.tools ?? []).map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }))
    // AI6 — sort by name so the tools array is byte-for-byte identical across
    // requests. The tools block sits in the cached prefix ahead of the system
    // prompt; if the MCP server ever returns tools in a different order, the
    // prefix changes and Anthropic's prompt cache (the cache_control mark on
    // the system block) silently misses on every call. A stable sort keeps the
    // cache warm. Dispatch is by name, so order never affects correctness.
    tools.sort((a, b) => a.name.localeCompare(b.name))
    _toolsCache = { tools, fetchedAt: Date.now() }
    return tools
  } catch {
    // On failure, return whatever we have cached (possibly stale) or an empty list.
    return _toolsCache?.tools ?? []
  }
}

export function bustToolsCache(): void {
  _toolsCache = null
}

export async function callHeroesTool(name: string, args: unknown): Promise<string> {
  try {
    const result = await mcpRequest('tools/call', { name, arguments: args }) as { content?: Array<{ type: string; text?: string }> } | null
    return (result?.content ?? [])
      .filter(c => c.type === 'text')
      .map(c => c.text ?? '')
      .join('\n') || '(no result)'
  } catch (e) {
    return `Error calling ${name}: ${e instanceof Error ? e.message : String(e)}`
  }
}

// ---------------------------------------------------------------------------
// Local tool: read_knowledge_doc
// ---------------------------------------------------------------------------

const READ_KNOWLEDGE_DOC_TOOL: Anthropic.Tool = {
  name: 'read_knowledge_doc',
  description:
    'Retrieve a specific knowledge doc by slug from the local knowledge base. ' +
    'The list of available slugs is in the always-included router doc. ' +
    'Use this BEFORE any Jobber tool call when the question is about the company, ' +
    'pricing, operations, or how to look things up in Jobber.',
  input_schema: {
    type: 'object',
    properties: {
      slug: { type: 'string', description: 'The doc slug to retrieve (e.g. "pricing", "jobber_lookups")' },
    },
    required: ['slug'],
  },
}

function isLocalToolName(name: string): boolean {
  return name === 'read_knowledge_doc'
}

// ---------------------------------------------------------------------------
// askClaude — main entry point
// ---------------------------------------------------------------------------

type SystemBlock =
  | string
  | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>

/**
 * Build the system prompt for a Guardian call. Returns the system param in the
 * shape Anthropic expects, with cache_control attached when the prefix is
 * large enough to trigger prompt caching (≥ 1024 tokens). When under the
 * floor we skip cache_control and log a warning — Anthropic silently ignores
 * under-threshold cache marks, so attaching it anyway would just pay full
 * price with no indication.
 */
async function buildSystemPrompt(
  basePrompt: string,
  companyId: string
): Promise<SystemBlock> {
  const admin = createAdminClient()
  let alwaysIncludedText = ''
  try {
    const docs = await getAlwaysIncludedDocs(admin, companyId)
    if (docs.length > 0) {
      alwaysIncludedText = docs
        .map(d => `## ${d.title}\n\n${d.body}`)
        .join('\n\n---\n\n')
    }
  } catch (e) {
    console.warn('[guardian] failed to load always-included docs:', e)
  }

  const fullText = alwaysIncludedText
    ? `${basePrompt}\n\n---\n\n${alwaysIncludedText}`
    : basePrompt

  const tokens = estimateTokens(fullText)
  if (tokens < PROMPT_CACHE_MIN_TOKENS) {
    console.warn(
      `[guardian] prompt cache skipped — system prompt under ${PROMPT_CACHE_MIN_TOKENS} tokens (~${tokens})`
    )
    return fullText
  }

  return [{ type: 'text', text: fullText, cache_control: { type: 'ephemeral' } }]
}

export async function askClaude({
  systemPrompt,
  userMessage,
  companyId,
  userId,
  tier,
  roomId,
  conversationId,
  isTest,
}: {
  systemPrompt: string
  userMessage: string
  companyId: string
  userId?: string | null
  tier: GuardianTier
  roomId?: string | null
  conversationId?: string | null
  isTest?: boolean
}): Promise<string> {
  const anthropic = getAnthropic({ timeout: 60_000, maxRetries: 2 })
  const adminClient = createAdminClient()

  const [mcpTools, system, settings, todayUsedCount] = await Promise.all([
    getHeroesTools(),
    buildSystemPrompt(systemPrompt, companyId),
    getGuardianSettings(adminClient, companyId).catch(() => ({
      model: CLAUDE_MODEL,
      web_search_daily_cap: 30,
    })),
    getTodayWebSearchCount(adminClient, companyId).catch(() => 0),
  ])

  const { model, web_search_daily_cap: dailyCap } = settings

  // Filter MCP tools by tier. Basic users see only read-only tools; full users see all.
  const toolFilter = getMcpToolFilter(tier)
  const filteredMcpTools = mcpTools.filter(t => toolFilter(t.name))

  // Local tools (read_knowledge_doc) come BEFORE MCP tools so the dispatcher
  // checks them first. Same name conflicts would resolve in our favor.
  const baseTools: Anthropic.Tool[] = [READ_KNOWLEDGE_DOC_TOOL, ...filteredMcpTools]

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }]

  // Tracks all tool calls Claude made across iterations for the audit log.
  const allToolCalls: string[] = []
  // Tracks server-side web searches Anthropic ran across iterations — declared
  // OUTSIDE the iteration loop so the per-question budget AND daily cap apply
  // across the whole agentic turn, not per-call.
  let searchesUsed = 0
  // Carries the final response usage block for the audit log.
  let lastUsage: { input_tokens?: number; output_tokens?: number } | null = null
  // Sentinel for the final answer Guardian returns.
  let finalAnswer = ''

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      // Compute remaining web-search budget for THIS iteration. Anthropic
      // enforces max_uses per API call, so set it to the smaller of
      // (per-question remaining) and (daily-cap remaining).
      const questionRemaining = PER_QUESTION_SEARCH_BUDGET - searchesUsed
      const dailyRemaining = dailyCap - todayUsedCount - searchesUsed
      const iterationSearchBudget = Math.max(0, Math.min(questionRemaining, dailyRemaining))
      const includeWebSearch = tier === 'full' && iterationSearchBudget > 0

      // Build the per-iteration tool array. We loosen the type with `unknown[]`
      // because Anthropic's web_search server tool has a different shape than
      // Anthropic.Tool (custom tool) — both are accepted by the API.
      const iterationTools: unknown[] = [...baseTools]
      if (includeWebSearch) {
        iterationTools.push({
          type: WEB_SEARCH_TOOL_TYPE,
          name: 'web_search',
          max_uses: iterationSearchBudget,
        })
      }

      const response = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        system,
        messages,
        ...(iterationTools.length > 0 ? { tools: iterationTools as Anthropic.Tool[] } : {}),
      })

      lastUsage = response.usage as { input_tokens?: number; output_tokens?: number }

      // Anthropic ran some web searches server-side — record them for daily cap.
      const serverToolUse = (response.usage as unknown as {
        server_tool_use?: { web_search_requests?: number }
      } | undefined)?.server_tool_use
      const newSearches = serverToolUse?.web_search_requests ?? 0
      if (newSearches > 0) {
        searchesUsed += newSearches
        // Fire-and-forget — daily counter is advisory; one extra search at the
        // boundary is acceptable per the spec.
        void incrementWebSearchUsage(adminClient, companyId, newSearches).catch(e =>
          console.warn('[guardian] web search usage increment failed:', e)
        )
      }

      const hasToolUse = response.content.some(b => b.type === 'tool_use')

      if (!hasToolUse || response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
        finalAnswer = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('')
          .trim()
        // AI5 — if the model hit the token ceiling the answer is cut off
        // mid-thought; tell the reader rather than leaving a dangling sentence.
        if (response.stop_reason === 'max_tokens') {
          finalAnswer += '\n\n_(Answer was cut off — ask me to continue for the rest.)_'
        }
        return finalAnswer
      }

      messages.push({ role: 'assistant', content: response.content })

      const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      // Track tool calls for the audit log.
      for (const block of toolUseBlocks) allToolCalls.push(block.name)

      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async block => {
          // Local tool dispatch — must run BEFORE the MCP call. If we let
          // read_knowledge_doc fall through to MCP, it would fail with
          // "unknown tool" and Guardian would never see the doc body.
          if (isLocalToolName(block.name)) {
            if (block.name === 'read_knowledge_doc') {
              const slugInput = (block.input as { slug?: unknown })?.slug
              const slug = typeof slugInput === 'string' ? slugInput : ''
              try {
                const result = await resolveReadKnowledgeDoc(adminClient, companyId, slug)
                return {
                  type: 'tool_result' as const,
                  tool_use_id: block.id,
                  content: JSON.stringify(result),
                }
              } catch (e) {
                return {
                  type: 'tool_result' as const,
                  tool_use_id: block.id,
                  content: `Error reading knowledge doc: ${e instanceof Error ? e.message : String(e)}`,
                  is_error: true,
                }
              }
            }
          }
          // Otherwise route through MCP.
          return {
            type: 'tool_result' as const,
            tool_use_id: block.id,
            content: await callHeroesTool(block.name, block.input),
          }
        })
      )

      messages.push({ role: 'user', content: toolResults })
    }

    finalAnswer = "I wasn't able to complete that request."
    return finalAnswer
  } finally {
    // Audit log — fire-and-forget. Runs whether the call succeeded, hit the
    // iteration cap, or threw. Never blocks the response.
    writeAuditLog(adminClient, {
      companyId,
      userId: userId ?? null,
      question: userMessage,
      answer: finalAnswer || null,
      model,
      toolsCalled: allToolCalls,
      webSearchesUsed: searchesUsed,
      inputTokens: lastUsage?.input_tokens ?? null,
      outputTokens: lastUsage?.output_tokens ?? null,
      isTest: isTest ?? false,
      guardianTier: tier,
      roomId: roomId ?? null,
      conversationId: conversationId ?? null,
    })
  }
}
