// Records the user's decision on the consent screen and issues (or declines to
// issue) an authorization code.
//
// The form carries ONE field: a one-time nonce. Every parameter of the
// authorization request — client, redirect_uri, PKCE challenge, state, resource
// — is read back from the mcp_oauth_requests row that /oauth/authorize wrote
// when it rendered the screen. Nothing here trusts a submitted value, because
// nothing here reads one.
//
// That replaces an earlier design where the parameters rode in hidden fields and
// were re-validated on arrival. Re-validation was sound as far as it went, but it
// could only check that a field was *acceptable*, never that it was the *same*
// value the client sent to /oauth/authorize — so the challenge that ended up
// bound to the authorization code came from the form. Now the two are the same
// row by construction.

import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { appOrigin, hashSecret, resourceIsAcceptable } from '@/lib/mcp-auth'
import { getAssistantSettings, resolveHubActor } from '@/lib/hub-actions'

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
  // CSRF, layer one. The nonce below is the real control — a cross-site post
  // cannot produce one that exists, is unconsumed, and belongs to this session's
  // user. This header check stays as the cheap outer layer that rejects the
  // obvious case before any DB work.
  //
  // (Note: the CSP's `form-action 'self'` is NOT a defense here — it constrains
  // where OUR pages may submit, not who may submit to US, and it is currently
  // report-only anyway.)
  //
  // ⚠ That report-only directive is a landmine for THIS flow specifically.
  // Chrome applies form-action across redirects, so promoting the report-only
  // CSP in next.config.ts to an enforced header would block the 303 below —
  // the consent page submits to us, and we redirect to the client's own origin.
  // Whoever enforces that CSP must relax form-action (or exclude this route)
  // first, or every Claude connection breaks at the last step.
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin') {
    return fail('That request did not come from Lynxedo.')
  }
  if (!fetchSite) {
    // Older clients omit Sec-Fetch-Site; fall back to an Origin comparison.
    const origin = request.headers.get('origin')
    if (origin && origin.replace(/\/$/, '') !== appOrigin()) {
      return fail('That request did not come from Lynxedo.')
    }
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail('That request was malformed.')
  }

  const decision = String(form.get('decision') || '')
  const nonce = String(form.get('request_nonce') || '')
  if (!nonce) {
    return fail('That connection request has expired or was already used. Start again from Claude.')
  }

  const admin = createAdminClient()

  const { data: reqRow } = await admin
    .from('mcp_oauth_requests')
    .select(
      'id, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, state, resource, expires_at, consumed_at',
    )
    .eq('nonce_hash', hashSecret(nonce))
    .maybeSingle()

  if (!reqRow) {
    return fail('That connection request has expired or was already used. Start again from Claude.')
  }
  const authRequest = reqRow as {
    id: string
    client_id: string
    user_id: string
    redirect_uri: string
    code_challenge: string
    code_challenge_method: string
    state: string | null
    resource: string | null
    expires_at: string
    consumed_at: string | null
  }
  if (authRequest.consumed_at) {
    return fail('That connection request was already used. Start again from Claude.')
  }
  if (Date.parse(authRequest.expires_at) <= Date.now()) {
    return fail('That connection request expired. Start again from Claude.')
  }

  // Require a session BEFORE any redirect — including the deny branch. Otherwise
  // an unauthenticated POST with a registered client is a POST-only open redirect
  // on our own domain.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('Your session expired before the connection finished. Start again.')

  // The nonce is bound to the person the screen was rendered for. Someone who
  // obtains another user's nonce must not be able to redeem it under their own
  // session — that would attach the grant to the wrong account.
  if (authRequest.user_id !== user.id) {
    return fail('That connection request was started by a different account. Start again.')
  }

  const { data: clientRow } = await admin
    .from('mcp_oauth_clients')
    .select('id, redirect_uris')
    .eq('id', authRequest.client_id)
    .maybeSingle()
  if (!clientRow) return fail("That app isn't registered with Lynxedo.")
  const client = clientRow as { id: string; redirect_uris: string[] }

  // Re-checked at redemption, not only at render: a client can edit its
  // registered redirect_uris between the two requests, and the address we send a
  // code to has to be one it currently claims.
  if (!client.redirect_uris.includes(authRequest.redirect_uri)) {
    return fail("The return address doesn't match one this app registered.")
  }
  // Likewise cheap to re-check, and the answer can change if the app's own
  // canonical address is ever reconfigured under it.
  if (!resourceIsAcceptable(authRequest.resource || '')) {
    return fail('That app asked for access to a different service than this one.')
  }

  // Burn the nonce before doing anything observable. Guarded so two concurrent
  // submissions (a double-click, a retried POST) can't both proceed.
  const { data: claimed } = await admin
    .from('mcp_oauth_requests')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', authRequest.id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle()
  if (!claimed) {
    return fail('That connection request was already used. Start again from Claude.')
  }

  // Only now is it safe to build a redirect back to the client.
  const target = new URL(authRequest.redirect_uri)

  // RFC 9207 — name the issuer on every authorization response, success or not,
  // so a client juggling several authorization servers can't be tricked into
  // handing our code to a different one. The AS metadata advertises support for
  // this, which means a conforming client will REJECT a response without it:
  // every redirect below has to carry it, including the deny branch.
  target.searchParams.set('iss', appOrigin())

  if (decision !== 'allow') {
    target.searchParams.set('error', 'access_denied')
    target.searchParams.set('error_description', 'The user declined the connection.')
    if (authRequest.state) target.searchParams.set('state', authRequest.state)
    return NextResponse.redirect(target.toString(), 303)
  }

  const actor = await resolveHubActor(admin, user.id, 'mcp')
  if (!actor) return fail("Your Lynxedo account isn't active or isn't attached to a company.")

  // Don't mint a durable 90-day grant for a company that hasn't turned this on.
  // Otherwise a consent-phishing campaign could harvest tokens across every
  // tenant that they'd then hold, inert, until an admin flips the feature live.
  const settings = await getAssistantSettings(admin, actor.companyId)
  if (!settings.enabled || !settings.mcpEnabled) {
    return fail(
      'Connecting Claude apps is not enabled for your company yet, so no connection was made. ' +
        'An admin can enable it in Admin → AI → Assistant.',
    )
  }

  const rawCode = randomBytes(32).toString('base64url')
  const { error } = await admin.from('mcp_oauth_codes').insert({
    code_hash: hashSecret(rawCode),
    client_id: client.id,
    company_id: actor.companyId,
    user_id: actor.userId,
    redirect_uri: authRequest.redirect_uri,
    code_challenge: authRequest.code_challenge,
    code_challenge_method: 'S256',
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  if (error) return fail('We could not complete the connection. Please try again.')

  target.searchParams.set('code', rawCode)
  if (authRequest.state) target.searchParams.set('state', authRequest.state)
  return NextResponse.redirect(target.toString(), 303)
}
