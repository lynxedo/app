// RFC 8414 authorization-server metadata.
//
// Tells a client where to register, where to send the user to consent, and where
// to exchange the code. PKCE S256 is advertised as the only challenge method —
// these are public clients with no secret, so PKCE is what binds the code to the
// client that requested it.

import { appOrigin, MCP_CORS_HEADERS } from '@/lib/mcp-auth'

export function OPTIONS() {
  return new Response(null, { status: 204, headers: MCP_CORS_HEADERS })
}

export function GET() {
  const origin = appOrigin()
  return new Response(
    JSON.stringify({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      revocation_endpoint: `${origin}/api/oauth/revoke`,
      scopes_supported: ['hub'],
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      // RFC 9207. Advertising this obliges us to put `iss` on every
      // authorization response — a conforming client rejects one without it.
      // Both redirects in app/api/oauth/consent/route.ts set it.
      authorization_response_iss_parameter_supported: true,
      service_documentation: `${origin}/help?tab=hub-assistant`,
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
