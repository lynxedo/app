import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

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
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, company_id, landing_page, can_access_routing, can_access_lawn, can_access_zone_sizer, can_access_call_log, can_access_responder, can_access_timesheet, can_access_tracker, can_access_hub, can_access_books, can_access_dialer, can_access_marketing, can_admin_people, can_admin_hub, can_admin_routing, can_admin_timesheet, can_admin_fleet, can_admin_daily_log, can_admin_zone_sizer, can_admin_dialer, can_admin_contacts, can_admin_marketing, companies(google_domain)')
      .eq('id', user.id)
      .single()

    const landingPath = profile?.landing_page === 'dashboard' ? '/dashboard' : '/hub/home'

    // Membership check: access is granted to anyone provisioned into a company —
    // i.e. explicitly invited by an admin. "Sign in with Google" stays restricted to
    // the company's Workspace domain because the new-user trigger only auto-creates a
    // profile for domain-matching emails; a Google account with no profile lands here
    // with no company_id and is signed out. Admin-invited users (ANY email, incl.
    // personal Gmail) get a profile at invite time and sign in with an email code.
    if (!profile || !profile.company_id) {
      const url = request.nextUrl.clone()
      url.pathname = '/api/auth/signout'
      url.searchParams.set('reason', 'unauthorized')
      return NextResponse.redirect(url)
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
        '/hub/call-log': 'can_access_call_log',
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

      // /hub/timesheet (personal admin timesheet view) is admin or timesheet-manager only
      if ((pathname === '/hub/timesheet' || pathname.startsWith('/hub/timesheet/')) && profile.role !== 'admin' && !profile.can_admin_timesheet) {
        const url = request.nextUrl.clone()
        url.pathname = '/hub'
        return NextResponse.redirect(url)
      }

      // Admin gate: super-admins (role=admin) get everything. Managers (role=manager) need
      // at least one can_admin_* flag for /hub/admin overall, and the specific flag for each subpath.
      if (pathname === '/hub/admin' || pathname.startsWith('/hub/admin/')) {
        const isSuperAdmin = profile.role === 'admin'
        const adminFlagMap: Record<string, keyof typeof profile> = {
          '/hub/admin/hub': 'can_admin_hub',
          '/hub/admin/guardian': 'can_admin_hub',
          '/hub/admin/txt': 'can_admin_hub',
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
