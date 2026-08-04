// Client-side Supabase auth-cookie cleanup.
//
// Two distinct stale-cookie states have been stranding users at login:
//
// 1. LEGACY HOST-ONLY COOKIES. Before subdomain routing (Track 2, July 18 2026) the
//    sb-* auth cookies were host-only. Every writer now sets them with
//    domain=.lynxedo.com, which the browser treats as a SEPARATE cookie of the same
//    name — the old host-only copy is never overwritten and keeps a long-rotated
//    refresh token. Whenever the Supabase browser client happens to read that fossil
//    first and presents its stale token, GoTrue's reuse detection revokes the entire
//    session family and force-logs the user out (Bonnie/Leon/Josh, Aug 2026).
//
// 2. DEAD-SESSION COOKIES AFTER A REVOCATION. Once a family is revoked, the cookies
//    still hold the dead session. On iOS the WKWebView cookie jar survives app and
//    phone restarts, so /auth/callback re-runs against the same wedged state forever.
//
// purgeLegacyHostOnlyAuthCookies() deletes ONLY the host-only variants (a Set-Cookie
// without a Domain attribute never touches the domain-wide cookie), so it is safe to
// run on every /login mount. It is gated on CROSS_SUBDOMAIN_COOKIE_DOMAIN so staging
// (where host-only cookies are the live session, flag off) is untouched.
//
// purgeAllAuthCookies() deletes both variants — the reset used when a sign-in attempt
// failed or timed out and we want a genuinely clean slate before retrying.

import { CROSS_SUBDOMAIN_COOKIE_DOMAIN } from '@/lib/tenant-host'

function authCookieNames(): string[] {
  if (typeof document === 'undefined') return []
  return document.cookie
    .split(';')
    .map((c) => c.split('=')[0]?.trim() ?? '')
    .filter((name) => name.startsWith('sb-'))
}

function expireHostOnly(name: string) {
  document.cookie = `${name}=; Max-Age=0; path=/`
}

function expireDomainWide(name: string) {
  if (!CROSS_SUBDOMAIN_COOKIE_DOMAIN) return
  document.cookie = `${name}=; Max-Age=0; path=/; domain=${CROSS_SUBDOMAIN_COOKIE_DOMAIN}`
}

/** Delete legacy host-only sb-* cookies, leaving the domain-wide session intact. */
export function purgeLegacyHostOnlyAuthCookies() {
  // Only meaningful when domain-wide cookies are the norm; on staging (flag off)
  // host-only cookies ARE the live session, so never touch them there.
  if (!CROSS_SUBDOMAIN_COOKIE_DOMAIN) return
  authCookieNames().forEach(expireHostOnly)
}

/** Delete every sb-* auth cookie (both host-only and domain-wide variants). */
export function purgeAllAuthCookies() {
  authCookieNames().forEach((name) => {
    expireHostOnly(name)
    expireDomainWide(name)
  })
}
