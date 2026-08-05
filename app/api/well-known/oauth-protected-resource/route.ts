// RFC 9728 protected-resource metadata.
//
// This is the document an MCP client fetches after a 401 tells it where to look
// (the WWW-Authenticate resource_metadata hint from lib/mcp-auth). It says:
// "this resource is guarded by that authorization server."
//
// Served from /api/well-known/* and exposed at /.well-known/* by a rewrite in
// next.config.ts — the Next app router ignores dot-prefixed directories, so the
// canonical path can't be a route folder.

import { appOrigin, MCP_CORS_HEADERS } from '@/lib/mcp-auth'

export function OPTIONS() {
  return new Response(null, { status: 204, headers: MCP_CORS_HEADERS })
}

export function GET() {
  const origin = appOrigin()
  return new Response(
    JSON.stringify({
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
      resource_name: 'Lynxedo Hub',
      resource_documentation: `${origin}/help?tab=hub-assistant`,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
        ...MCP_CORS_HEADERS,
      },
    },
  )
}
