// The OAuth consent screen.
//
// A server component so the Lynxedo session is read server-side and the consent
// form is rendered with the REAL permission list for this user — not a static
// blurb. The user sees which client is asking, which company and account it will
// act as, and exactly what it will be able to do.
//
// Not logged in → bounce to /login?next=<this page> and come straight back.
//
// The form POSTs to our own origin (/api/oauth/consent), and that handler is what
// redirects out to the client's registered redirect_uri. Note `form-action 'self'`
// is NOT a CSRF control here (it constrains where our pages may submit, not who
// may submit to us, and it's report-only today) — the handler enforces
// same-origin itself.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { consentSummary, getAssistantSettings, resolveHubActor } from '@/lib/hub-actions'

type SearchParams = Record<string, string | string[] | undefined>

function one(params: SearchParams, key: string): string {
  const v = params[key]
  return (Array.isArray(v) ? v[0] : v) || ''
}

function ErrorCard({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-950 p-6">
      <div className="max-w-md w-full rounded-xl border border-red-500/30 bg-gray-900 p-6">
        <h1 className="text-lg font-semibold text-[#fff]">{title}</h1>
        <p className="mt-2 text-sm text-white/70">{detail}</p>
        <p className="mt-4 text-xs text-white/40">
          Nothing has been connected. You can close this window.
        </p>
      </div>
    </main>
  )
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams

  const clientId = one(params, 'client_id')
  const redirectUri = one(params, 'redirect_uri')
  const state = one(params, 'state')
  const codeChallenge = one(params, 'code_challenge')
  const codeChallengeMethod = one(params, 'code_challenge_method') || 'S256'
  const responseType = one(params, 'response_type') || 'code'

  // Validate the request BEFORE showing a session-bearing page.
  if (!clientId || !redirectUri || !codeChallenge) {
    return (
      <ErrorCard
        title="Incomplete connection request"
        detail="This link is missing information the app should have provided (client, redirect, or PKCE challenge). Try starting the connection again from Claude."
      />
    )
  }
  if (responseType !== 'code') {
    return <ErrorCard title="Unsupported request" detail="Only the authorization-code flow is supported." />
  }
  if (codeChallengeMethod !== 'S256') {
    return (
      <ErrorCard
        title="Unsupported security method"
        detail="This server requires PKCE with S256. Update the client and try again."
      />
    )
  }

  const admin = createAdminClient()
  const { data: clientRow } = await admin
    .from('mcp_oauth_clients')
    .select('id, client_name, redirect_uris')
    .eq('id', clientId)
    .maybeSingle()

  if (!clientRow) {
    return (
      <ErrorCard
        title="Unknown app"
        detail="That app isn't registered with Lynxedo. Try starting the connection again."
      />
    )
  }
  const client = clientRow as { id: string; client_name: string | null; redirect_uris: string[] }

  // Exact match only. This is the check that stops an attacker from swapping in
  // their own redirect target to capture the code.
  if (!client.redirect_uris.includes(redirectUri)) {
    return (
      <ErrorCard
        title="Redirect address not recognized"
        detail="The address this app asked us to send you back to isn't one it registered. For your safety the connection was stopped."
      />
    )
  }

  // Session check — after validation so we never bounce a user through login for
  // a malformed request.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const self = `/oauth/authorize?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      response_type: responseType,
      ...(state ? { state } : {}),
    }).toString()}`
    redirect(`/login?next=${encodeURIComponent(self)}`)
  }

  const actor = await resolveHubActor(admin, user.id, 'mcp')
  if (!actor) {
    return (
      <ErrorCard
        title="This account can't connect"
        detail="Your Lynxedo account isn't active, or isn't attached to a company. Ask an admin to check your access."
      />
    )
  }

  const { data: companyRow } = await admin
    .from('companies')
    .select('name')
    .eq('id', actor.companyId)
    .maybeSingle()
  const companyName = ((companyRow as { name?: string } | null)?.name || 'your company').trim()

  const settings = await getAssistantSettings(admin, actor.companyId)
  const capabilities = consentSummary(actor, settings)
  const assistantOff = !settings.enabled || !settings.mcpEnabled

  // WHERE the code will be sent is the single most important fact on this screen.
  // Registration is open by design, so `client_name` is attacker-controlled — an
  // impostor can call itself "Claude". The redirect host is the part they can't
  // fake without owning that domain, so it has to be visible.
  let redirectHost = redirectUri
  try {
    redirectHost = new URL(redirectUri).host
  } catch {
    // validated above; fall back to the raw value
  }

  // Has this person connected this client before? A first-time connection is
  // where a phishing attempt would land, so say so plainly.
  const { count: priorGrants } = await admin
    .from('mcp_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', actor.userId)
    .eq('client_id', client.id)
  const firstTime = (priorGrants ?? 0) === 0

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-950 p-6">
      <div className="max-w-lg w-full rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h1 className="text-lg font-semibold text-[#fff]">
          Connect {client.client_name || 'this app'} to Lynxedo?
        </h1>
        <p className="mt-2 text-sm text-white/70">
          It will act as <strong className="text-[#fff]">{actor.displayName}</strong> in{' '}
          <strong className="text-[#fff]">{companyName}</strong>, with exactly the permissions your
          account already has — nothing more.
        </p>

        <div className="mt-4 rounded-lg border border-gray-700 bg-gray-950/60 p-3 text-sm">
          <p className="text-white/60">
            Sign-in codes will be sent to{' '}
            <strong className="text-[#fff]">{redirectHost}</strong>
          </p>
          <p className="mt-1 text-xs text-white/50">
            {firstTime
              ? "You haven't connected this app before. If you didn't just start this yourself, or that address doesn't look like the app you expected, press Cancel."
              : 'You have connected this app before.'}
          </p>
        </div>

        {assistantOff ? (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            The Hub Assistant isn&apos;t switched on for {companyName} yet, so this connection
            can&apos;t be completed. An admin can enable it in Admin → AI → Assistant, then you can
            try again.
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-xs uppercase tracking-wide text-white/40">It will be able to</p>
            <ul className="mt-2 space-y-1 text-sm text-white/80">
              {capabilities.map((c) => (
                <li key={c} className="flex gap-2">
                  <span aria-hidden className="text-white/40">
                    •
                  </span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-4 text-xs text-white/50">
          Texting a customer always asks you to confirm the exact message first. You can disconnect
          this app at any time in Settings → Claude Connection.
        </p>

        <form method="POST" action="/api/oauth/consent" className="mt-6 flex gap-3">
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="code_challenge" value={codeChallenge} />
          <input type="hidden" name="code_challenge_method" value={codeChallengeMethod} />
          <input type="hidden" name="state" value={state} />
          {!assistantOff && (
            <button
              type="submit"
              name="decision"
              value="allow"
              className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-[#fff] hover:opacity-90"
            >
              Allow
            </button>
          )}
          <button
            type="submit"
            name="decision"
            value="deny"
            className="flex-1 rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-white/80 hover:bg-gray-800"
          >
            Cancel
          </button>
        </form>
      </div>
    </main>
  )
}
