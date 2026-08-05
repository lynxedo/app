// RFC 7009 token revocation.
//
// Per the spec this always returns 200, even for an unknown token — telling a
// caller "that token doesn't exist" would turn this into a token oracle.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { hashSecret, MCP_CORS_HEADERS } from '@/lib/mcp-auth'

export function OPTIONS() {
  return new Response(null, { status: 204, headers: MCP_CORS_HEADERS })
}

export async function POST(request: Request) {
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown'
  const limit = rateLimit(`oauth:revoke:${ip}`, 60, 60_000)
  if (!limit.ok) {
    return NextResponse.json({}, { status: 429, headers: MCP_CORS_HEADERS })
  }

  let token = ''
  try {
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { token?: unknown }
      token = typeof body.token === 'string' ? body.token : ''
    } else {
      const form = await request.formData()
      token = String(form.get('token') || '')
    }
  } catch {
    token = ''
  }

  if (token) {
    const admin = createAdminClient()
    const { data } = await admin
      .from('mcp_tokens')
      .select('id, user_id, client_id, kind')
      .eq('token_hash', hashSecret(token))
      .maybeSingle()

    const row = data as { id: string; user_id: string; client_id: string | null; kind: string } | null
    if (row) {
      const now = new Date().toISOString()
      // Revoking either half of an OAuth pair should end the whole connection —
      // a client left holding a live access token after the user disconnected is
      // exactly the surprise we want to avoid.
      if (row.kind !== 'personal' && row.client_id) {
        await admin
          .from('mcp_tokens')
          .update({ revoked_at: now })
          .eq('user_id', row.user_id)
          .eq('client_id', row.client_id)
          .is('revoked_at', null)
      } else {
        await admin.from('mcp_tokens').update({ revoked_at: now }).eq('id', row.id).is('revoked_at', null)
      }
    }
  }

  return NextResponse.json({}, { status: 200, headers: { 'Cache-Control': 'no-store', ...MCP_CORS_HEADERS } })
}
