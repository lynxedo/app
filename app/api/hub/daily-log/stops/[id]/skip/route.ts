import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function authResolve(stopId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return { error: 'Profile not found', status: 404 as const }

  const admin = createAdminClient()
  const { data: stop } = await admin
    .from('daily_log_stops')
    .select('id, status, arrived_at, entry_id, daily_log_entries!inner(company_id)')
    .eq('id', stopId)
    .single()
  if (!stop) return { error: 'Stop not found', status: 404 as const }

  const entry = Array.isArray(stop.daily_log_entries)
    ? stop.daily_log_entries[0]
    : stop.daily_log_entries
  if (!entry || entry.company_id !== profile.company_id) {
    return { error: 'Stop not found', status: 404 as const }
  }
  return { admin, stop, userId: user.id, companyId: profile.company_id }
}

// POST — mark stop as skipped with a reason code.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const resolved = await authResolve(id)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { admin, stop, companyId } = resolved

  if (stop.status === 'complete') {
    return NextResponse.json({ error: 'Reopen the stop before skipping it.' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({})) as {
    skip_reason_id?: unknown
    skip_reason_label?: unknown
  }

  let reasonId: string | null = null
  let reasonLabel: string | null = null

  // If a reason id is provided, validate it belongs to this company.
  if (typeof body.skip_reason_id === 'string' && body.skip_reason_id) {
    const { data: reason } = await admin
      .from('daily_log_skip_reasons')
      .select('id, label')
      .eq('id', body.skip_reason_id)
      .eq('company_id', companyId)
      .eq('active', true)
      .single()
    if (!reason) {
      return NextResponse.json({ error: 'Skip reason not found' }, { status: 404 })
    }
    reasonId = reason.id
    reasonLabel = reason.label
  } else if (typeof body.skip_reason_label === 'string' && body.skip_reason_label.trim()) {
    // Allow freeform label when no mapped reason is selected.
    reasonLabel = body.skip_reason_label.trim().slice(0, 100)
  }

  const { data: updated, error } = await admin
    .from('daily_log_stops')
    .update({
      status: 'skipped',
      skip_reason_id: reasonId,
      skip_reason_label: reasonLabel,
      // Clear arrival data when skipping a pending/in-progress stop.
      completed_at: null,
      completed_by: null,
    })
    .eq('id', stop.id)
    .select('id, ord, status, arrived_at, completed_at, skip_reason_id, skip_reason_label')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }
  return NextResponse.json({ stop: updated })
}

// DELETE — unskip: revert to pending or in_progress based on arrived_at.
export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const resolved = await authResolve(id)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { admin, stop } = resolved

  if (stop.status !== 'skipped') {
    return NextResponse.json({ error: 'Stop is not skipped.' }, { status: 400 })
  }

  const revertedStatus = stop.arrived_at ? 'in_progress' : 'pending'

  const { data: updated, error } = await admin
    .from('daily_log_stops')
    .update({
      status: revertedStatus,
      skip_reason_id: null,
      skip_reason_label: null,
    })
    .eq('id', stop.id)
    .select('id, ord, status, arrived_at, completed_at, skip_reason_id, skip_reason_label')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }
  return NextResponse.json({ stop: updated })
}
