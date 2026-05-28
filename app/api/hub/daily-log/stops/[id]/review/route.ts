import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function resolveAdminStop(stopId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_admin_daily_log')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return { error: 'Profile not found', status: 404 as const }

  const isAdmin = profile.role === 'admin' || !!profile.can_admin_daily_log
  if (!isAdmin) return { error: 'Forbidden', status: 403 as const }

  const admin = createAdminClient()
  const { data: stop } = await admin
    .from('daily_log_stops')
    .select('id, daily_log_entries!inner(company_id)')
    .eq('id', stopId)
    .single()

  if (!stop) return { error: 'Stop not found', status: 404 as const }

  const entry = Array.isArray(stop.daily_log_entries)
    ? stop.daily_log_entries[0]
    : stop.daily_log_entries
  if (!entry || entry.company_id !== profile.company_id) {
    return { error: 'Stop not found', status: 404 as const }
  }

  return { admin, userId: user.id }
}

// POST — mark stop as reviewed by the current admin user
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const resolved = await resolveAdminStop(id)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { admin, userId } = resolved

  const now = new Date().toISOString()
  const { data: updated, error } = await admin
    .from('daily_log_stops')
    .update({ office_reviewed_at: now, office_reviewed_by: userId })
    .eq('id', id)
    .select('office_reviewed_at, office_reviewed_by')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ stop: updated })
}

// DELETE — undo the reviewed marker
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const resolved = await resolveAdminStop(id)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { admin } = resolved

  const { data: updated, error } = await admin
    .from('daily_log_stops')
    .update({ office_reviewed_at: null, office_reviewed_by: null })
    .eq('id', id)
    .select('office_reviewed_at, office_reviewed_by')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ stop: updated })
}
