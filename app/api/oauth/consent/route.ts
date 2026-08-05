// Records the user's decision on the consent screen and issues (or declines to
// issue) an authorization code.
//
// Everything security-relevant is re-validated here — the consent page's checks
// don't carry over, because this is a separate request and its form fields are
// attacker-editable. In particular the redirect_uri is re-checked against the
// client's registered list before we ever redirect to it.

import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashSecret } from '@/lib/mcp-auth'
import { resolveHubActor } from '@/lib/hub-actions'

/** Codes are single-use and short-lived; 60s is ample for an immediate exchange. */
const CODE_TTL_MS = 60_000

function fail(detail: string) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Connection stopped</title>` +
      `<body style="font:14px system-ui;padding:2rem;background:#0b0f14;color:#e5e7eb">` +
      `<h1 style="font-size:1rem">Connection stopped</h1><p>${detail}</p>` +
      `<p style="color:#9ca3af">Nothing has been connected. You can close this window.</p></body>`,
    { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

export async function POST(request: Request) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail('That request was malformed.')
  }

  const decision = String(form.get('decision') || '')
  const clientId = String(form.get('client_id') || '')
  const redirectUri = String(form.get('redirect_uri') || '')
  const codeChallenge = String(form.get('code_challenge') || '')
  const codeChallengeMethod = String(form.get('code_challenge_method') || 'S256')
  const state = String(form.get('state') || '')

  if (!clientId || !redirectUri || !codeChallenge) {
    return fail('That request was missing required information.')
  }
  if (codeChallengeMethod !== 'S256') {
    return fail('This server requires PKCE with S256.')
  }

  const admin = createAdminClient()
  const { data: clientRow } = await admin
    .from('mcp_oauth_clients')
    .select('id, redirect_uris')
    .eq('id', clientId)
    .maybeSingle()
  if (!clientRow) return fail("That app isn't registered with Lynxedo.")
  const client = clientRow as { id: string; redirect_uris: string[] }

  // Re-check exact match. Without this, a crafted form post could redirect the
  // code anywhere — the consent page's check protects nothing on its own.
  if (!client.redirect_uris.includes(redirectUri)) {
    return fail("The return address doesn't match one this app registered.")
  }

  // Only now is it safe to build a redirect back to the client.
  const target = new URL(redirectUri)

  if (decision !== 'allow') {
    target.searchParams.set('error', 'access_denied')
    target.searchParams.set('error_description', 'The user declined the connection.')
    if (state) target.searchParams.set('state', state)
    return NextResponse.redirect(target.toString(), 303)
  }

  // The session is the authorization: we mint a code for whoever is signed in.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('Your session expired before the connection finished. Start again.')

  const actor = await resolveHubActor(admin, user.id, 'mcp')
  if (!actor) return fail("Your Lynxedo account isn't active or isn't attached to a company.")

  const rawCode = randomBytes(32).toString('base64url')
  const { error } = await admin.from('mcp_oauth_codes').insert({
    code_hash: hashSecret(rawCode),
    client_id: client.id,
    company_id: actor.companyId,
    user_id: actor.userId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  if (error) return fail('We could not complete the connection. Please try again.')

  target.searchParams.set('code', rawCode)
  if (state) target.searchParams.set('state', state)
  return NextResponse.redirect(target.toString(), 303)
}
