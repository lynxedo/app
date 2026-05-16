import Anthropic from '@anthropic-ai/sdk'

const MCP_URL = 'https://mcp.lynxedo.com/mcp'
const MAX_TOOL_ITERATIONS = 6

async function mcpRequest(method: string, params: unknown = {}): Promise<unknown> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    // 10s timeout
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

export async function getHeroesTools(): Promise<Anthropic.Tool[]> {
  try {
    const result = await mcpRequest('tools/list') as { tools?: Array<{ name: string; description?: string; inputSchema: Anthropic.Tool['input_schema'] }> } | null
    return (result?.tools ?? []).map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }))
  } catch {
    return []
  }
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

export async function askClaude({
  systemPrompt,
  userMessage,
}: {
  systemPrompt: string
  userMessage: string
}): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const tools = await getHeroesTools()

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }]

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
    })

    const hasToolUse = response.content.some(b => b.type === 'tool_use')

    if (!hasToolUse || response.stop_reason === 'end_turn') {
      return response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim()
    }

    // Add assistant turn with tool use blocks
    messages.push({ role: 'assistant', content: response.content })

    // Execute all tool calls in parallel
    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async block => ({
        type: 'tool_result' as const,
        tool_use_id: block.id,
        content: await callHeroesTool(block.name, block.input),
      }))
    )

    messages.push({ role: 'user', content: toolResults })
  }

  return "I wasn't able to complete that request."
}
