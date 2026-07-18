// Track 2 (multi-tenant): subdomain <-> tenant resolution helpers.
//
// All of this is gated behind NEXT_PUBLIC_SUBDOMAIN_ROUTING_ENABLED so the code can
// ship to prod DARK. When the flag is unset/false, every caller behaves exactly as the
// single-tenant app does today (no host parsing, no cross-subdomain cookies, no redirects).
//
// SECURITY NOTE: the host/subdomain is NEVER the authorization boundary. Authorization is
// always the authenticated user's company_id + RLS. The subdomain is a UX/routing guard
// and defense-in-depth only — the two are designed to agree, but the URL never grants access.
//
// Pure string helpers only (no server-only APIs) so this module is safe to import from
// both middleware/server code and the browser Supabase client.

export const SUBDOMAIN_ROUTING_ENABLED =
  process.env.NEXT_PUBLIC_SUBDOMAIN_ROUTING_ENABLED === 'true'

// When subdomain routing is on, auth cookies must be shared across *.lynxedo.com so a
// session established on the apex (or during OAuth callback) survives the redirect to
// {slug}.lynxedo.com. Undefined when the flag is off => host-only cookies (today's behavior).
export const CROSS_SUBDOMAIN_COOKIE_DOMAIN: string | undefined =
  SUBDOMAIN_ROUTING_ENABLED ? '.lynxedo.com' : undefined

const ROOT_DOMAIN = 'lynxedo.com'

// Subdomains that are infrastructure / environment hosts, NOT tenants.
const RESERVED_SUBDOMAINS = new Set([
  'www', 'staging', 'mcp', 'lawn', 'routing', 'sandbox', 'relay', 'voice', 'app', 'api',
])

// Strip a :port and lowercase.
function normalizeHost(host: string | null | undefined): string {
  return (host || '').split(':')[0].trim().toLowerCase()
}

// The tenant slug for a host, or null for the apex / a reserved host / a non-lynxedo host.
//   heroes105.lynxedo.com          -> 'heroes105'
//   heroes105.staging.lynxedo.com  -> 'heroes105'   (staging tenant host)
//   lynxedo.com / staging.lynxedo.com / www.lynxedo.com / mcp.lynxedo.com -> null
//   localhost / an IP / anything not *.lynxedo.com -> null
export function tenantSlugFromHost(host: string | null | undefined): string | null {
  const hostname = normalizeHost(host)
  if (!hostname.endsWith('.' + ROOT_DOMAIN)) return null
  const label = hostname.slice(0, -('.' + ROOT_DOMAIN).length) // 'heroes105' or 'heroes105.staging'
  if (!label) return null
  const slug = label.split('.')[0]
  if (!slug || RESERVED_SUBDOMAINS.has(slug)) return null
  return slug
}

// Build the hostname a given tenant should live on, preserving the current environment
// (prod apex vs staging). Used to redirect a user to their own subdomain.
//   (lynxedo.com, 'heroes105')          -> 'heroes105.lynxedo.com'
//   (staging.lynxedo.com, 'heroes105')  -> 'heroes105.staging.lynxedo.com'
//   (demo.lynxedo.com, 'heroes105')     -> 'heroes105.lynxedo.com'   (swap first label)
export function tenantHostname(currentHost: string | null | undefined, slug: string): string {
  const hostname = normalizeHost(currentHost)
  if (hostname === ROOT_DOMAIN || hostname === 'www.' + ROOT_DOMAIN) {
    return `${slug}.${ROOT_DOMAIN}`
  }
  if (hostname === 'staging.' + ROOT_DOMAIN) {
    return `${slug}.staging.${ROOT_DOMAIN}`
  }
  const dot = hostname.indexOf('.')
  if (dot === -1) return hostname // localhost / bare host — leave unchanged
  return slug + hostname.slice(dot)
}
