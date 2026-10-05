import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export type CompanyCaller = {
  userId: string
  companyId: string
  role: string | null
  /** The RLS-scoped session client this helper already built — reuse it for the
   *  route's queries instead of calling createClient() again. */
  supabase: Awaited<ReturnType<typeof createClient>>
}

/**
 * A tool grant an API must check itself (Ben, Oct 5 2026: the middleware in
 * proxy.ts gates PAGES only — its matcher skips /api — so a Routing / Tracker /
 * Lawn API that checked only "signed in + same company" answered anyone in the
 * company). Allowed = the admin role or the grant, same as the Tracker
 * from-source / draft-note routes.
 */
export type FeatureGrant = 'can_access_routing' | 'can_access_tracker' | 'can_access_lawn'

function hasGrant(profile: { role?: string | null } & Partial<Record<FeatureGrant, boolean | null>>, grant: FeatureGrant): boolean {
  return profile.role === 'admin' || profile[grant] === true
}

/** For routes that already authenticated: a 403 response when the caller lacks `grant`, else null. */
export async function denyWithoutGrant(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  grant: FeatureGrant,
): Promise<NextResponse | null> {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_access_routing, can_access_tracker, can_access_lawn')
    .eq('id', userId)
    .single()
  if (!profile || !hasGrant(profile, grant)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

/**
 * Canonical "which company is the caller in" helper (multi-tenant Track 1).
 *
 * Authenticates the cookie session and resolves the caller's company_id from
 * user_profiles. Fails closed: no session → 401, no company → 403. Routes that
 * run service-role (admin-client) queries — which bypass RLS — must scope every
 * read/write by this companyId, or verify a target row's company_id matches it
 * before acting.
 *
 * Usage:
 *   const auth = await requireCompany()                              // or { grant: 'can_access_tracker' }
 *   if ('error' in auth) return auth.error
 *   const { companyId, userId, role } = auth
 *
 * `role` is included so callers that also gate on role === 'admin' don't need a
 * second user_profiles query. For feature-flag admin gates keep using
 * requireAdminArea() (lib/admin-auth.ts), which already returns company_id.
 */
export async function requireCompany(opts?: { grant?: FeatureGrant }): Promise<CompanyCaller | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_access_routing, can_access_tracker, can_access_lawn')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id) {
    return { error: NextResponse.json({ error: 'No company' }, { status: 403 }) }
  }
  if (opts?.grant && !hasGrant(profile, opts.grant)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { userId: user.id, companyId: profile.company_id, role: profile.role ?? null, supabase }
}

/**
 * Lenient company resolver for surfaces that already run under the Hub session
 * but must NOT hard-fail if the session lookup hiccups — specifically the
 * PIN-gated Books / QuickBooks dashboard (which sits inside /hub, so the session
 * is normally present, but is additionally PIN-gated and must never 500 Heroes'
 * live financials over a transient auth read).
 *
 * Resolves the caller's company_id from the Hub session; on any miss returns the
 * supplied `fallback` (never throws). Normal Hub API routes should keep using
 * requireCompany() / requireAdminArea(), which fail closed.
 */
export async function resolveSessionCompanyId(fallback: string): Promise<string> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('company_id')
        .eq('id', user.id)
        .single()
      if (profile?.company_id) return profile.company_id
    }
  } catch {
    // fall through to the fallback
  }
  return fallback
}
