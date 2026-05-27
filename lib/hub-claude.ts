import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  estimateTokens,
  getAlwaysIncludedDocs,
  getGuardianModel,
  resolveReadKnowledgeDoc,
} from '@/lib/guardian-knowledge'

const MCP_URL = 'https://mcp.lynxedo.com/mcp'
const MAX_TOOL_ITERATIONS = 6
const TOOLS_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
const PROMPT_CACHE_MIN_TOKENS = 1024 // Anthropic's activation floor
const DEFAULT_MODEL = 'claude-sonnet-4-6'

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
}: {
  systemPrompt: string
  userMessage: string
  companyId: string
}): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const [mcpTools, system, model] = await Promise.all([
    getHeroesTools(),
    buildSystemPrompt(systemPrompt, companyId),
    getGuardianModel(createAdminClient(), companyId).catch(() => DEFAULT_MODEL),
  ])

  // Local tools (read_knowledge_doc) come BEFORE MCP tools so the dispatcher
  // checks them first. Same name conflicts would resolve in our favor.
  const allTools: Anthropic.Tool[] = [READ_KNOWLEDGE_DOC_TOOL, ...mcpTools]
  const adminClient = createAdminClient()

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }]

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system,
      messages,
      ...(allTools.length > 0 ? { tools: allTools } : {}),
    })

    const hasToolUse = response.content.some(b => b.type === 'tool_use')

    if (!hasToolUse || response.stop_reason === 'end_turn') {
      return response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim()
    }

    messages.push({ role: 'assistant', content: response.content })

    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
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

  return "I wasn't able to complete that request."
}
