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
    .select('id, status, arrived_at, completed_at, daily_log_entries!inner(company_id)')
    .eq('id', stopId)
    .single()
  if (!stop) return { error: 'Stop not found', status: 404 as const }

  const entry = Array.isArray(stop.daily_log_entries)
    ? stop.daily_log_entries[0]
    : stop.daily_log_entries
  if (!entry || entry.company_id !== profile.company_id) {
    return { error: 'Stop not found', status: 404 as const }
  }
  return { admin, stop, userId: user.id }
}

// POST — stamp arrival, flip to in_progress.
// Idempotent for the "already arrived" case (returns existing data).
export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const resolved = await authResolve(id)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { admin, stop } = resolved

  // If already arrived, leave the original timestamp intact (don't reset).
  if (stop.arrived_at) {
    return NextResponse.json({
      stop: {
        id: stop.id,
        status: stop.status,
        arrived_at: stop.arrived_at,
        completed_at: stop.completed_at,
      },
      already_arrived: true,
    })
  }

  // If the stop is already complete, arriving doesn't really make sense —
  // but be forgiving: stamp arrived_at and leave status='complete'.
  const newStatus = stop.status === 'complete' ? 'complete' : 'in_progress'

  const { data: updated, error } = await admin
    .from('daily_log_stops')
    .update({ arrived_at: new Date().toISOString(), status: newStatus })
    .eq('id', stop.id)
    .select('id, status, arrived_at, completed_at')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }
  return NextResponse.json({ stop: updated })
}

// DELETE — clear arrival timestamp (misclick recovery). Only allowed when
// the stop isn't already complete; if it is complete, the user should
// Reopen first.
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

  if (stop.status === 'complete') {
    return NextResponse.json(
      { error: 'Reopen the stop first, then clear the arrival time.' },
      { status: 400 },
    )
  }

  const { data: updated, error } = await admin
    .from('daily_log_stops')
    .update({ arrived_at: null, status: 'pending' })
    .eq('id', stop.id)
    .select('id, status, arrived_at, completed_at')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }
  return NextResponse.json({ stop: updated })
}
