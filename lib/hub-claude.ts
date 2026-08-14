import { randomUUID } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getGuardianSettings,
  resolveReadKnowledgeDoc,
} from '@/lib/guardian-knowledge'
import { buildGuardianSystem } from '@/lib/guardian-persona'
import { getMcpToolFilter, type AssistantCapability } from '@/lib/guardian-permissions'
import {
  getTodayWebSearchCount,
  incrementWebSearchUsage,
  writeAuditLog,
} from '@/lib/guardian-audit'
import {
  getAssistantSettings,
  hubActionTools,
  isHubActionName,
  listHubActions,
  logAssistantEvent,
  resolveHubActor,
  runHubAction,
} from '@/lib/hub-actions'

const MCP_URL = 'https://mcp.lynxedo.com/mcp'

// ⚠ MCP_URL above is the ORIGINAL single-tenant Heroes105 MCP server: it holds
// Heroes' own Jobber OAuth token and is not company-scoped in any way. Serving
// its tools to another tenant's Guardian would hand them Heroes' customer data,
// so the legacy tools are pinned to the company that owns that server. Every
// other tenant gets the native, tenant-scoped action layer (lib/hub-actions)
// instead — which is the long-term home for these capabilities.
const HEROES_MCP_COMPANY_ID =
  process.env.HEROES_MCP_COMPANY_ID || '00000000-0000-0000-0000-000000000002'
// How many rounds of tool use one turn may take.
//
// ⚠ This was 6, and 6 was far too low for the work people actually ask for. Real
// requests routinely spent two rounds on knowledge docs before starting, then one
// round per page of a paginated API — so "give me the service addresses of the PW
// customers" and a multi-step Jobber reschedule both died at the ceiling, and the
// old behaviour on hitting it was to DISCARD every result gathered and reply
// "I wasn't able to complete that request." One real turn threw away 1,825 tokens
// of finished work that way.
//
// Two things changed together, and the second matters more than the number: the
// ceiling is higher, and running out is now a wrap-up (answer with what you have,
// say what's missing) instead of a silent failure. So a generous cap is safe —
// the worst case is a partial answer, not a lie.
const MAX_TOOL_ITERATIONS = 16
// Wall-clock ceiling for the whole agentic turn. The iteration count alone can't
// bound latency: 16 rounds of a slow external API is minutes of silence in a chat
// window. Whichever limit is reached first triggers the same wrap-up.
const TOOL_LOOP_BUDGET_MS = 180_000
const TOOLS_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
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
  | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' } }>

/**
 * Build the system prompt for a Guardian call. Delegates to the shared
 * buildGuardianSystem() so a direct @Guardian question shares the exact same
 * identity (GUARDIAN_CORE), always-included Knowledge Base docs, and the
 * customer-service playbook (knowledge: 'customer') used by the Responder and
 * the Txt2/Hub composer helpers — so "how do I handle this customer?" answers
 * from the real playbook. The caller's basePrompt (the Hub assistant framing +
 * conversation history) is passed as the task layer. cache_control is attached
 * to the stable prefix when it's large enough to cache.
 */
async function buildSystemPrompt(
  basePrompt: string,
  companyId: string
): Promise<SystemBlock> {
  return buildGuardianSystem({
    companyId,
    knowledge: 'customer',
    surface: 'guardian',
    task: basePrompt,
  })
}

export async function askClaude({
  systemPrompt,
  userMessage,
  companyId,
  userId,
  capability,
  roomId,
  conversationId,
  isTest,
}: {
  systemPrompt: string
  userMessage: string
  companyId: string
  userId?: string | null
  /** 'manage' (managers/admins: all tools + web search) or 'read' (lookups only). */
  capability: AssistantCapability
  roomId?: string | null
  conversationId?: string | null
  isTest?: boolean
}): Promise<string> {
  const anthropic = getAnthropic({ timeout: 60_000, maxRetries: 2 })
  const adminClient = createAdminClient()

  // The legacy Heroes MCP server is single-tenant — only fetch its tools for the
  // company that owns it (see HEROES_MCP_COMPANY_ID above).
  const legacyMcpAllowed = companyId === HEROES_MCP_COMPANY_ID

  const [mcpTools, system, settings, todayUsedCount, assistantSettings] = await Promise.all([
    legacyMcpAllowed ? getHeroesTools() : Promise.resolve([] as Anthropic.Tool[]),
    buildSystemPrompt(systemPrompt, companyId),
    getGuardianSettings(adminClient, companyId).catch(() => ({
      model: CLAUDE_MODEL,
      web_search_daily_cap: 30,
    })),
    getTodayWebSearchCount(adminClient, companyId).catch(() => 0),
    // Batched with the rest so an assistant-off company pays no extra round trip
    // on the latency path — someone is waiting on this reply in the Hub.
    getAssistantSettings(adminClient, companyId),
  ])

  const { model, web_search_daily_cap: dailyCap } = settings

  // Native, tenant-scoped actions (lib/hub-actions) — the assistant layer that
  // works for ANY subscriber. Offered only when the company has switched the
  // assistant on and only for actions this specific user's permissions allow, so
  // Guardian can never do something on someone's behalf that they can't do
  // themselves. Resolving the actor needs a real user id; a call without one
  // (an automated/system Guardian post) gets no actions.
  const actor =
    userId && assistantSettings.enabled
      ? await resolveHubActor(adminClient, userId, 'guardian').catch(() => null)
      : null
  // A stale/foreign userId must not borrow another tenant's actions.
  const activeActor = actor && actor.companyId === companyId ? actor : null
  const nativeActions = activeActor ? listHubActions(activeActor, assistantSettings) : []
  const nativeTools = hubActionTools(nativeActions)

  // Filter legacy MCP tools by capability (read-capability users see only
  // read-only tools; managers/admins see all) AND withhold any that duplicate a
  // capability the native action layer owns — otherwise the model can reach the
  // ungated copy of an action an admin has switched off. Computed here rather
  // than earlier because the shadow only applies once we know the action layer
  // is actually engaged for this caller.
  const toolFilter = getMcpToolFilter(capability, {
    nativeActionsActive: activeActor !== null,
  })
  const filteredMcpTools = mcpTools.filter(t => toolFilter(t.name))

  // One id for this whole turn. An outward action staged during this turn cannot
  // be confirmed during it — Guardian only runs on a human message, so requiring
  // a later turn requires a real person to have replied. See hub-actions/pending.
  const turnId = randomUUID()

  // Local tools (read_knowledge_doc + native actions) come BEFORE MCP tools so
  // the dispatcher checks them first. Same name conflicts resolve in our favor.
  const baseTools: Anthropic.Tool[] = [READ_KNOWLEDGE_DOC_TOOL, ...nativeTools, ...filteredMcpTools]

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

  const loopStartedAt = Date.now()

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      // Compute remaining web-search budget for THIS iteration. Anthropic
      // enforces max_uses per API call, so set it to the smaller of
      // (per-question remaining) and (daily-cap remaining).
      const questionRemaining = PER_QUESTION_SEARCH_BUDGET - searchesUsed
      const dailyRemaining = dailyCap - todayUsedCount - searchesUsed
      const iterationSearchBudget = Math.max(0, Math.min(questionRemaining, dailyRemaining))
      const includeWebSearch = capability === 'manage' && iterationSearchBudget > 0

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

          // Native tenant-scoped actions. Checked before MCP so a name that
          // exists in both resolves to the permission-gated native version.
          if (activeActor && isHubActionName(block.name)) {
            const content = await runHubAction(
              { admin: adminClient, actor: activeActor, turnId },
              assistantSettings,
              block.name,
              block.input,
            )
            // Deliberately NOT metered here — see the per-turn logAssistantEvent
            // in the finally block below.
            return { type: 'tool_result' as const, tool_use_id: block.id, content }
          }

          // A native action the model tried WITHOUT an eligible actor (assistant
          // off, or no resolvable user) must not fall through to the legacy MCP
          // server — say so instead.
          if (isHubActionName(block.name)) {
            return {
              type: 'tool_result' as const,
              tool_use_id: block.id,
              content:
                'That action needs the Hub Assistant to be enabled for this company, and it is not. Tell the user an admin can turn it on in Admin → AI → Assistant.',
              is_error: true,
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

      if (Date.now() - loopStartedAt > TOOL_LOOP_BUDGET_MS) break
    }

    // Out of tool budget (iterations or wall clock). Everything gathered this turn
    // is sitting in `messages` — throwing it away and replying "I wasn't able to
    // complete that request" is the worst available outcome: the user can't tell a
    // real dead end from a ceiling, and work that was actually finished looks like
    // a failure. So ask for a final answer with NO tools instead: partial results
    // plus an honest account of what's missing.
    const WRAP_UP =
      'You have used up the tool budget for this turn, so you cannot call any more tools. ' +
      'Answer now using everything you have already gathered above. Give the user the real ' +
      'partial result — the rows, names, numbers or steps you did get — and then say plainly ' +
      'which part you did not finish and what would finish it (a narrower question, or asking ' +
      'you to continue). Do NOT say you were unable to complete the request if you have any ' +
      'usable information, and do not invent anything you did not retrieve.'

    const lastMessage = messages[messages.length - 1]
    if (lastMessage && lastMessage.role === 'user' && Array.isArray(lastMessage.content)) {
      // Append to the tool_result message rather than pushing a second user turn —
      // consecutive same-role messages are not valid on the API.
      ;(lastMessage.content as Anthropic.ContentBlockParam[]).push({ type: 'text', text: WRAP_UP })
    } else {
      messages.push({ role: 'user', content: WRAP_UP })
    }

    try {
      const wrapUp = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        system,
        messages,
        // No tools on purpose — this call must terminate.
      })
      lastUsage = wrapUp.usage as { input_tokens?: number; output_tokens?: number }
      finalAnswer = wrapUp.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim()
    } catch (e) {
      console.warn('[guardian] wrap-up call failed:', e)
    }

    if (!finalAnswer) {
      // Even the wrap-up failed. Name the work that was done rather than implying
      // nothing happened — some of these tools have already changed real records.
      finalAnswer = allToolCalls.length
        ? `I ran out of room on this one after ${allToolCalls.length} lookups and couldn't pull the answer together. ` +
          `I did run: ${[...new Set(allToolCalls)].join(', ')} — so some of that may have gone through. ` +
          `Ask me again with a narrower question and I'll get it.`
        : "I wasn't able to complete that request."
    }
    return finalAnswer
  } finally {
    // Billing meter — ONE row per assistant turn, not one per tool call.
    //
    // It used to log inside the tool-dispatch loop, which billed the customer for
    // the assistant's own internal choices: a question answered from context
    // billed nothing at all, while a request that happened to need six lookups
    // billed six times. Neither matches what the person did — they asked once.
    // Worse, a turn that used a legacy MCP tool logged nothing, so the meter
    // quietly under-counted (fixed separately, but the unit was wrong either way).
    //
    // Now: one row per inbound request on each door — a Guardian turn here, a
    // tools/call over MCP (where claude.ai genuinely does make one request per
    // tool, so per-request already IS per-turn there).
    //
    // Skipped when the assistant is switched off for the company (Guardian still
    // answers via the legacy path for the MCP-owning tenant, and billing someone
    // for a feature they haven't enabled would be wrong) and for test calls.
    if (assistantSettings.enabled && !isTest) {
      logAssistantEvent(adminClient, {
        companyId,
        userId: activeActor?.userId ?? userId ?? null,
        source: 'guardian',
        // The tool names for this turn, for cost analysis — the meter itself
        // counts rows, so this is diagnostics, not the billable quantity.
        toolName: allToolCalls.length ? allToolCalls.join(',').slice(0, 200) : null,
        toolCalls: allToolCalls.length,
        // Populated for the first time here. These columns existed but were
        // always null, which is why the real per-turn cost had to be
        // reconstructed from guardian_audit instead of read off the meter.
        inputTokens: lastUsage?.input_tokens ?? null,
        outputTokens: lastUsage?.output_tokens ?? null,
        model,
      })
    }

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
      // Audit column predates the capability model; it stores 'manage'/'read'
      // now (older rows keep their basic/manager/full values).
      guardianTier: capability,
      roomId: roomId ?? null,
      conversationId: conversationId ?? null,
    })
  }
}
