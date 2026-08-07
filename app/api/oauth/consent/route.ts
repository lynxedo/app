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
  // CSRF: this endpoint is authenticated only by the session cookie and mints an
  // authorization code, so a cross-site form post that carried the cookie would be
  // account takeover. @supabase/ssr sets SameSite=Lax which already blocks that,
  // but relying on a library default for the only control is too thin — one future
  // change to sameSite would silently open it. Require a same-origin submission.
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
  const clientId = String(form.get('client_id') || '')
  const redirectUri = String(form.get('redirect_uri') || '')
  const codeChallenge = String(form.get('code_challenge') || '')
  const codeChallengeMethod = String(form.get('code_challenge_method') || 'S256')
  const state = String(form.get('state') || '')
  const resource = String(form.get('resource') || '')

  if (!clientId || !redirectUri || !codeChallenge) {
    return fail('That request was missing required information.')
  }
  if (codeChallengeMethod !== 'S256') {
    return fail('This server requires PKCE with S256.')
  }
  // Re-checked here for the same reason every other field is: these are form
  // fields, so the consent page having validated them proves nothing.
  if (!resourceIsAcceptable(resource)) {
    return fail('That app asked for access to a different service than this one.')
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

  // Require a session BEFORE any redirect — including the deny branch. Otherwise
  // an unauthenticated POST with a registered client is a POST-only open redirect
  // on our own domain.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('Your session expired before the connection finished. Start again.')

  // Only now is it safe to build a redirect back to the client.
  const target = new URL(redirectUri)

  // RFC 9207 — name the issuer on every authorization response, success or not,
  // so a client juggling several authorization servers can't be tricked into
  // handing our code to a different one. The AS metadata advertises support for
  // this, which means a conforming client will REJECT a response without it:
  // every redirect below has to carry it, including the deny branch.
  target.searchParams.set('iss', appOrigin())

  if (decision !== 'allow') {
    target.searchParams.set('error', 'access_denied')
    target.searchParams.set('error_description', 'The user declined the connection.')
    if (state) target.searchParams.set('state', state)
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
