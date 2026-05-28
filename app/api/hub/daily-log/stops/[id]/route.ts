import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// PATCH — update mutable fields on a stop (notes, pesticide_tech_notes)
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const body = await request.json() as { notes?: string | null; pesticide_tech_notes?: string | null }
  const updates: Record<string, unknown> = {}
  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string' && body.notes !== null) {
      return NextResponse.json({ error: 'notes must be a string or null' }, { status: 400 })
    }
    if (typeof body.notes === 'string' && body.notes.length > 5000) {
      return NextResponse.json({ error: 'notes too long (max 5000 chars)' }, { status: 400 })
    }
    updates.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null
  }
  if (body.pesticide_tech_notes !== undefined) {
    if (typeof body.pesticide_tech_notes !== 'string' && body.pesticide_tech_notes !== null) {
      return NextResponse.json({ error: 'pesticide_tech_notes must be a string or null' }, { status: 400 })
    }
    if (typeof body.pesticide_tech_notes === 'string' && body.pesticide_tech_notes.length > 2000) {
      return NextResponse.json({ error: 'pesticide_tech_notes too long (max 2000 chars)' }, { status: 400 })
    }
    updates.pesticide_tech_notes = typeof body.pesticide_tech_notes === 'string'
      ? body.pesticide_tech_notes.trim() || null
      : null
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Verify company scope before writing.
  const { data: stop } = await admin
    .from('daily_log_stops')
    .select('id, daily_log_entries!inner(company_id)')
    .eq('id', id)
    .single()
  if (!stop) {
    return NextResponse.json({ error: 'Stop not found' }, { status: 404 })
  }
  const entry = Array.isArray(stop.daily_log_entries)
    ? stop.daily_log_entries[0]
    : stop.daily_log_entries
  if (!entry || entry.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Stop not found' }, { status: 404 })
  }

  const { data: updated, error } = await admin
    .from('daily_log_stops')
    .update(updates)
    .eq('id', id)
    .select('id, notes, pesticide_tech_notes, updated_at')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ stop: updated })
}
