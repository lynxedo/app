// The official Lynxedo Hub MCP server.
//
// JSON-RPC 2.0 over Streamable HTTP (stateless — no session id needed, so a
// client can POST every request independently). Exposes the SAME tenant-scoped
// action layer the in-Hub assistant uses (lib/hub-actions), authenticated by a
// bearer token that resolves to exactly one company + one user.
//
// This replaces reaching into Supabase with a service-role key, which is what
// Claude had to do before and which could never be given to a subscriber.
//
// Auth: Authorization: Bearer <lxmcp_… | lxoat_…>. A 401 carries the
// WWW-Authenticate header that starts OAuth discovery for claude.ai.

import { after } from 'next/server'
import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { enforceRateLimit } from '@/lib/extension-auth'
import {
  authenticateMcpRequest,
  mcpJson,
  mcpPreflight,
  mcpUnauthorized,
  MCP_CORS_HEADERS,
} from '@/lib/mcp-auth'
import {
  getAssistantSettings,
  hubActionTools,
  listHubActions,
  logAssistantEvent,
  resolveHubActor,
  runHubAction,
} from '@/lib/hub-actions'

// The protocol version we implement. Clients send their own; we echo ours.
const PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'lynxedo-hub', version: '1.0.0' }

type JsonRpcId = string | number | null

function rpcResult(id: JsonRpcId, result: unknown): Response {
  return mcpJson({ jsonrpc: '2.0', id, result })
}

function rpcError(id: JsonRpcId, code: number, message: string, httpStatus = 200): Response {
  return mcpJson({ jsonrpc: '2.0', id, error: { code, message } }, httpStatus)
}

export function OPTIONS() {
  return mcpPreflight()
}

/**
 * GET is used by MCP clients to open an SSE stream for server-initiated
 * messages. This server is stateless and never initiates, so we decline cleanly
 * rather than holding a socket open — clients treat 405 here as "POST only".
 */
export function GET() {
  return new Response(
    JSON.stringify({ error: 'This MCP endpoint is stateless — use POST for JSON-RPC requests.' }),
    { status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS', ...MCP_CORS_HEADERS } },
  )
}

export async function POST(request: Request) {
  const auth = await authenticateMcpRequest(request)
  if (!auth) return mcpUnauthorized()

  // Per-token limits. Tool calls are the expensive path (they hit the DB and can
  // send texts); listing is cheap but still bounded.
  const limited = enforceRateLimit([
    { key: `mcp:req:min:${auth.tokenId}`, limit: 120, windowMs: 60_000 },
    { key: `mcp:req:day:${auth.tokenId}`, limit: 5_000, windowMs: 86_400_000 },
  ])
  if (limited) return limited

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return rpcError(null, -32700, 'Parse error: body is not valid JSON', 400)
  }

  // Batches are legal JSON-RPC but the MCP spec dropped them in 2025-06-18.
  if (Array.isArray(body)) {
    return rpcError(null, -32600, 'Batched requests are not supported', 400)
  }
  if (!body || typeof body !== 'object') {
    return rpcError(null, -32600, 'Invalid Request', 400)
  }

  const msg = body as { jsonrpc?: unknown; id?: JsonRpcId; method?: unknown; params?: unknown }
  const id: JsonRpcId = msg.id === undefined ? null : (msg.id as JsonRpcId)
  const method = typeof msg.method === 'string' ? msg.method : ''
  if (!method) return rpcError(id, -32600, 'Invalid Request: missing method', 400)

  // Notifications (no id) expect no body — acknowledge with 202.
  const isNotification = msg.id === undefined

  const admin = createAdminClient()

  switch (method) {
    case 'initialize': {
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Lynxedo Hub — this company\'s field-service operations: contacts and customers, the work ' +
          'schedule, texts, calls and voicemails, sales leads, and task boards. Actions run as the ' +
          'signed-in user with their own permissions. Texting a customer is a two-step action: it ' +
          'previews first and needs explicit confirmation before anything is sent.',
      })
    }

    case 'notifications/initialized':
    case 'notifications/cancelled': {
      return new Response(null, { status: 202, headers: MCP_CORS_HEADERS })
    }

    case 'ping': {
      return isNotification
        ? new Response(null, { status: 202, headers: MCP_CORS_HEADERS })
        : rpcResult(id, {})
    }

    case 'tools/list': {
      const actor = await resolveHubActor(admin, auth.userId, 'mcp')
      // The token's company must still match the user's — a user moved between
      // companies (or offboarded) must not keep acting on the old tenant.
      if (!actor || actor.companyId !== auth.companyId) {
        return rpcError(id, -32001, 'This connection is no longer valid for that account.')
      }
      const settings = await getAssistantSettings(admin, auth.companyId)
      if (!settings.enabled || !settings.mcpEnabled) {
        // An empty tool list is the honest answer: the connection is fine, the
        // company just hasn't turned the assistant (or MCP access) on.
        return rpcResult(id, { tools: [] })
      }
      const tools = hubActionTools(listHubActions(actor, settings)).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.input_schema,
      }))
      return rpcResult(id, { tools })
    }

    case 'tools/call': {
      const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as {
        name?: unknown
        arguments?: unknown
      }
      const name = typeof params.name === 'string' ? params.name : ''
      if (!name) return rpcError(id, -32602, 'Invalid params: tool name is required')

      const actor = await resolveHubActor(admin, auth.userId, 'mcp')
      if (!actor || actor.companyId !== auth.companyId) {
        return rpcError(id, -32001, 'This connection is no longer valid for that account.')
      }
      const settings = await getAssistantSettings(admin, auth.companyId)
      if (!settings.enabled || !settings.mcpEnabled) {
        return rpcResult(id, {
          content: [
            {
              type: 'text',
              text:
                'The Hub Assistant is not enabled for this company, so no actions can run. An admin can ' +
                'turn it on in Admin → AI → Assistant.',
            },
          ],
          isError: true,
        })
      }

      // A fresh turn id per request. Over MCP this never blocks a confirm (each
      // tools/call is its own request), which is exactly why outward actions over
      // MCP are gated on allowOutwardOverMcp instead — see hub-actions/catalog.
      const text = await runHubAction(
        { admin, actor, turnId: randomUUID() },
        settings,
        name,
        params.arguments,
      )

      after(() => {
        logAssistantEvent(admin, {
          companyId: actor.companyId,
          userId: actor.userId,
          source: 'mcp',
          toolName: name,
          toolCalls: 1,
        })
      })

      return rpcResult(id, { content: [{ type: 'text', text }] })
    }

    // Declared-but-empty capabilities: answer politely so a client that probes
    // them doesn't treat the server as broken.
    case 'resources/list':
      return rpcResult(id, { resources: [] })
    case 'prompts/list':
      return rpcResult(id, { prompts: [] })

    default: {
      if (isNotification) return new Response(null, { status: 202, headers: MCP_CORS_HEADERS })
      return rpcError(id, -32601, `Method not found: ${method}`)
    }
  }
}
