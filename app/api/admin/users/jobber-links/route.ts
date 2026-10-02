import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

// GET /api/admin/users/jobber-links
//
// Work Orders Phase 1.5 — which Jobber user each Hub person is, for the
// "Jobber user" picker in Admin → People. Reads the jobber_users mirror (no
// Jobber API call), so it works even when the connection is down. The feed
// falls back to a first-name match for anyone left unlinked.

export async function GET() {
  const check = await requireAdminArea('people')
  if (!check.ok || !check.user || !check.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const admin = createAdminClient()
  const [{ data: hub }, { data: jobber }] = await Promise.all([
    admin.from('hub_users').select('id, jobber_user_id').eq('company_id', check.company_id).eq('is_bot', false),
    admin.from('jobber_users').select('external_id, name, is_active').eq('company_id', check.company_id).order('name', { ascending: true }),
  ])
  const links: Record<string, string | null> = {}
  for (const h of hub ?? []) links[h.id as string] = (h.jobber_user_id as string | null) ?? null
  const jobberUsers = (jobber ?? []).map(j => ({
    id: j.external_id as string,
    name: (j.name as string) || (j.external_id as string),
    isActive: j.is_active !== false,
  }))
  return NextResponse.json({ links, jobberUsers })
}
