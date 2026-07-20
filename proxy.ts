import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  SUBDOMAIN_ROUTING_ENABLED,
  CROSS_SUBDOMAIN_COOKIE_DOMAIN,
  tenantSlugFromHost,
  tenantHostname,
} from '@/lib/tenant-host'
import { moduleForPath, isBillableModuleEntitled } from '@/lib/billing/entitlements'
import { getBillingMode } from '@/lib/billing/catalog'

// Fail-fast guard (Phase 5, after the 2026-06-14 Supabase Auth outage). Every request
// hits getUser() + a profile fetch here; when auth degrades those hang on retries and
// take the whole site down. Bound each to ~2s. getUser timeout → treat as logged-out
// (protected routes redirect to /login below). A profile-fetch timeout is handled
// specially: we must NOT sign the user out (that would destroy a valid session on a
// transient blip) — instead bounce protected routes to the login form for this request.
const AUTH_TIMEOUT_MS = 2000

function withTimeout<T>(promise: PromiseLike<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value) },
      () => { clearTimeout(timer); resolve(fallback) },
    )
  })
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...options,
              // Track 2: share the session across *.lynxedo.com so it survives the
              // apex -> {slug}.lynxedo.com redirect. Off (undefined) => host-only, as today.
              ...(CROSS_SUBDOMAIN_COOKIE_DOMAIN ? { domain: CROSS_SUBDOMAIN_COOKIE_DOMAIN } : {}),
            })
          )
        },
      },
    }
  )

  const user = await withTimeout(
    supabase.auth.getUser().then(({ data }) => data.user),
    AUTH_TIMEOUT_MS,
    null,
  )

  const { pathname } = request.nextUrl
  const protectedPaths = ['/dashboard', '/routing', '/lawn', '/responder', '/call-log', '/timesheet', '/tracker', '/hub']
  const isProtected = protectedPaths.some(p => pathname === p || pathname.startsWith(p + '/'))

  // Redirect unauthenticated users to login
  if (!user && isProtected) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user) {
    // Single fetch: profile + company — used for domain check and permission enforcement
    const profileResult = await withTimeout(
      supabase
        .from('user_profiles')
        .select('role, is_platform_admin, company_id, landing_page, can_access_routing, can_access_lawn, can_access_zone_sizer, can_access_call_log, can_access_responder, can_access_timesheet, can_access_tracker, can_access_hub, can_access_books, can_access_dialer, can_access_marketing, can_admin_people, can_admin_hub, can_admin_guardian, can_admin_txt, can_admin_announcements, can_admin_file_tags, can_admin_routing, can_admin_timesheet, can_admin_fleet, can_admin_daily_log, can_admin_zone_sizer, can_admin_dialer, can_admin_contacts, can_admin_marketing, companies(google_domain, subdomain_slug)')
        .eq('id', user.id)
        .single()
        .then(({ data }) => ({ data, degraded: false })),
      AUTH_TIMEOUT_MS,
      { data: null, degraded: true },
    )

    // Auth degraded (profile fetch timed out): do NOT sign out — that would destroy a
    // valid session on a transient blip. Fail-fast instead: bounce protected routes to
    // the login form, and let everything else through unguarded for this one request.
    if (profileResult.degraded) {
      if (isProtected && pathname !== '/login') {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
      }
      return supabaseResponse
    }

    const profile = profileResult.data
    const landingPath = profile?.landing_page === 'dashboard' ? '/dashboard' : '/hub/home'

    // Membership check: access is granted to anyone provisioned into a company —
    // i.e. explicitly invited by an admin, or whose email domain matched a company
    // in the new-user trigger. An account with no company_id never matched and
    // wasn't invited (e.g. a brand-new public sign-up, including Sign in with
    // Apple with Hide My Email). Send it to a clean /welcome screen rather than a
    // hard sign-out — RLS blocks all data while company_id is null, and /welcome
    // offers a sign-out. (/welcome is outside this middleware's matcher, so there
    // is no redirect loop.)
    if (!profile || !profile.company_id) {
      const url = request.nextUrl.clone()
      url.pathname = '/welcome'
      url.search = ''
      return NextResponse.redirect(url)
    }

    // Subdomain tenant routing (Track 2). DARK until NEXT_PUBLIC_SUBDOMAIN_ROUTING_ENABLED=true.
    // The authenticated user's company_id + RLS remain the security boundary; the host is a
    // UX/routing guard only. Keep the user on their own {slug}.lynxedo.com: if they land on
    // the apex, a reserved host, or someone else's tenant subdomain, bounce them to their own,
    // preserving the requested path. Companies without a subdomain_slug are never redirected
    // (nothing to route to), so this is a no-op for any tenant not yet given a slug.
    if (SUBDOMAIN_ROUTING_ENABLED) {
      const host = request.headers.get('host')
      const hostSlug = tenantSlugFromHost(host)
      const companiesRel = (profile as unknown as {
        companies?:
          | { subdomain_slug?: string | null }
          | { subdomain_slug?: string | null }[]
          | null
      }).companies
      const mySlug =
        (Array.isArray(companiesRel) ? companiesRel[0]?.subdomain_slug : companiesRel?.subdomain_slug) ?? null

      if (mySlug && hostSlug !== mySlug) {
        const url = request.nextUrl.clone()
        url.protocol = 'https:'
        url.hostname = tenantHostname(host, mySlug)
        url.port = ''
        return NextResponse.redirect(url)
      }
    }

    // Redirect logged-in users away from login to their preferred landing page
    if (pathname === '/login') {
      const url = request.nextUrl.clone()
      url.pathname = landingPath
      return NextResponse.redirect(url)
    }

    // Permission checks for authenticated users on tool + admin routes
    if (isProtected && profile) {
      const permissionMap: Record<string, keyof typeof profile> = {
        '/routing': 'can_access_routing',
        '/lawn': 'can_access_lawn',
        '/call-log': 'can_access_call_log',
        '/responder': 'can_access_responder',
        '/timesheet': 'can_access_timesheet',
        '/tracker': 'can_access_tracker',
        '/hub': 'can_access_hub',
        '/hub/timesheet': 'can_access_timesheet',
        // /hub/call-log (the merged Call Log) is gated at the page + data-route
        // level by an OR of can_access_call_log / can_access_call_log2 /
        // can_admin_dialer / admin — which this single-flag map can't express —
        // so it's intentionally NOT listed here. /hub/call-log2 just redirects.
        '/hub/lawn': 'can_access_lawn',
        '/hub/tracker': 'can_access_tracker',
        '/hub/routing': 'can_access_routing',
        '/hub/books': 'can_access_books',
        '/hub/zone-sizer': 'can_access_zone_sizer',
        '/hub/dialer': 'can_access_dialer',
        '/hub/marketing': 'can_access_marketing',
      }

      for (const [route, permKey] of Object.entries(permissionMap)) {
        if ((pathname === route || pathname.startsWith(route + '/')) && !profile[permKey]) {
          const url = request.nextUrl.clone()
          url.pathname = route.startsWith('/hub/') ? '/hub' : '/dashboard'
          return NextResponse.redirect(url)
        }
      }

      // Track 5 (M3) — company-level module gating (fail-open). For a billable module
      // route, block access when the company has a gating-active subscription that does
      // NOT include this module. Runs AFTER the per-user check above, so it only queries
      // for a route the user already has the grant for. A company with no active
      // subscription (every existing tenant, incl. Heroes) is never gated → redirect
      // to the Billing page so they can subscribe.
      const billableModule = moduleForPath(pathname)
      if (billableModule && profile.company_id) {
        const entitled = await isBillableModuleEntitled(
          supabase,
          profile.company_id as string,
          getBillingMode(),
          billableModule,
        )
        if (!entitled) {
          const url = request.nextUrl.clone()
          url.pathname = '/hub/billing'
          return NextResponse.redirect(url)
        }
      }

      // Admin gate: super-admins (role=admin) get everything. Managers (role=manager) need
      // at least one can_admin_* flag for /hub/admin overall, and the specific flag for each subpath.
      if (pathname === '/hub/admin' || pathname.startsWith('/hub/admin/')) {
        // Platform super-admin console (cross-company): gated on is_platform_admin,
        // NOT the company-scoped role==='admin'. A company admin without the platform
        // capability is redirected out even though they otherwise pass the admin gate.
        if (pathname === '/hub/admin/platform' || pathname.startsWith('/hub/admin/platform/')) {
          if (!profile.is_platform_admin) {
            const url = request.nextUrl.clone()
            url.pathname = '/hub/home'
            return NextResponse.redirect(url)
          }
        }
        const isSuperAdmin = profile.role === 'admin'
        const adminFlagMap: Record<string, keyof typeof profile> = {
          '/hub/admin/hub': 'can_admin_hub',
          '/hub/admin/guardian': 'can_admin_guardian',
          '/hub/admin/txt': 'can_admin_txt',
          '/hub/admin/announcements': 'can_admin_announcements',
          '/hub/admin/file-tags': 'can_admin_file_tags',
          '/hub/admin/routing': 'can_admin_routing',
          '/hub/admin/timesheet': 'can_admin_timesheet',
          '/hub/admin/fleet': 'can_admin_fleet',
          '/hub/admin/daily-log': 'can_admin_daily_log',
          '/hub/admin/zone-sizer': 'can_admin_zone_sizer',
          '/hub/admin/dialer': 'can_admin_dialer',
          '/hub/admin/contacts': 'can_admin_contacts',
          '/hub/admin/marketing': 'can_admin_marketing',
        }
        const anyAdminGrant =
          profile.can_admin_people ||
          profile.can_admin_hub ||
          profile.can_admin_guardian ||
          profile.can_admin_txt ||
          profile.can_admin_announcements ||
          profile.can_admin_file_tags ||
          profile.can_admin_routing ||
          profile.can_admin_timesheet ||
          profile.can_admin_fleet ||
          profile.can_admin_daily_log ||
          profile.can_admin_zone_sizer ||
          profile.can_admin_dialer ||
          profile.can_admin_contacts

        if (!isSuperAdmin && !anyAdminGrant) {
          const url = request.nextUrl.clone()
          url.pathname = '/hub/home'
          return NextResponse.redirect(url)
        }

        if (!isSuperAdmin) {
          // /hub/admin (People tab) requires can_admin_people specifically
          if (pathname === '/hub/admin' && !profile.can_admin_people) {
            const url = request.nextUrl.clone()
            const firstGrant = Object.entries(adminFlagMap).find(([, key]) => profile[key])
            url.pathname = firstGrant ? firstGrant[0] : '/hub/home'
            return NextResponse.redirect(url)
          }
          for (const [route, flagKey] of Object.entries(adminFlagMap)) {
            if ((pathname === route || pathname.startsWith(route + '/')) && !profile[flagKey]) {
              const url = request.nextUrl.clone()
              url.pathname = profile.can_admin_people ? '/hub/admin' : '/hub/home'
              return NextResponse.redirect(url)
            }
          }
        }
      }
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/dashboard/:path*', '/routing/:path*', '/lawn/:path*', '/lawn',
    '/responder/:path*', '/call-log/:path*', '/call-log',
    '/timesheet/:path*', '/timesheet',
    '/tracker/:path*', '/tracker',
    '/hub/:path*', '/hub', '/login',
  ],
}
