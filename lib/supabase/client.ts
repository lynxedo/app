import { createBrowserClient } from '@supabase/ssr'
import { CROSS_SUBDOMAIN_COOKIE_DOMAIN } from '@/lib/tenant-host'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { flowType: 'pkce' },
      // Track 2: when subdomain routing is on, the session cookie set client-side at login
      // must be visible across *.lynxedo.com so the redirect to {slug}.lynxedo.com stays
      // logged in. Off (undefined) => host-only cookie, exactly as today.
      ...(CROSS_SUBDOMAIN_COOKIE_DOMAIN ? { cookieOptions: { domain: CROSS_SUBDOMAIN_COOKIE_DOMAIN } } : {}),
    }
  )
}
