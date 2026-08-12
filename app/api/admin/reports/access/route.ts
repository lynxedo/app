import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { REPORTS } from '@/lib/reports/registry'

// Admin-only: grant/revoke which REPORTS a user may open (Admin → Reports).
// Layer 2 of the §12 access model; `can_access_reports` (Admin → People) is layer 1
// and only opens the section. Default is nothing-until-granted.
//
// Deliberately a mirror of /api/admin/scoreboards/board-access, down to the guard
// order, so there is one shape to review rather than two. Writes go through the
// service-role client (bypasses RLS); `report_access` has no write policy at all.
async function getAdminCompany(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.role !== 'admin' || !profile.company_id) return null
  return profile.company_id as string
}

const VALID_SLUGS = new Set(REPORTS.map(r => r.slug))

export async function POST(request: Request) {
  const company = await getAdminCompany()
  if (!company) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({})) as { user_id?: string; report_slug?: string; granted?: boolean }
  const userId = String(body.user_id || '').trim()
  const reportSlug = String(body.report_slug || '').trim()
  const granted = !!body.granted
  if (!userId || !reportSlug) {
    return NextResponse.json({ error: 'user_id and report_slug are required' }, { status: 400 })
  }
  // Only slugs the registry knows about. Stops a typo (or a stale client) writing a
  // grant row that matches no report and can never be revoked from the UI.
  if (!VALID_SLUGS.has(reportSlug)) {
    return NextResponse.json({ error: 'Unknown report' }, { status: 404 })
  }

  const admin = createAdminClient()

  // The target user must belong to THIS admin's company. Without this an admin
  // could grant a report to a user in another tenant, and the grant would be read
  // back by that user's own layout — company_id on the row is not enough on its own.
  const { data: target } = await admin
    .from('user_profiles').select('id').eq('id', userId).eq('company_id', company).maybeSingle()
  if (!target) return NextResponse.json({ error: 'Unknown user' }, { status: 404 })

  if (granted) {
    const { error } = await admin
      .from('report_access')
      .upsert(
        { company_id: company, user_id: userId, report_slug: reportSlug },
        { onConflict: 'company_id,user_id,report_slug' }
      )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await admin
      .from('report_access')
      .delete()
      .eq('company_id', company)
      .eq('user_id', userId)
      .eq('report_slug', reportSlug)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
