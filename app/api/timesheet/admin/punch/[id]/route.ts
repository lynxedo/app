import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recomputeDayEntry } from '@/lib/timesheet-recompute'
import { centralDate } from '@/lib/timezone'

// PATCH /api/timesheet/admin/punch/[id] — admin edits a punch time
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && !profile?.can_admin_timesheet) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const { punched_at, edit_reason } = body

  if (!punched_at) return NextResponse.json({ error: 'punched_at required' }, { status: 400 })
  if (!edit_reason) return NextResponse.json({ error: 'edit_reason required' }, { status: 400 })

  // Fetch original punch to save audit trail
  const { data: original } = await supabase
    .from('time_punches')
    .select('punched_at, original_punched_at')
    .eq('id', id)
    .single()

  if (!original) return NextResponse.json({ error: 'Punch not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('time_punches')
    .update({
      punched_at,
      edit_reason,
      edited_by: user.id,
      original_punched_at: original.original_punched_at ?? original.punched_at,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Recompute the time_entry for this employee/date
  const { data: punch } = await supabase
    .from('time_punches')
    .select('employee_id, punch_type, punched_at')
    .eq('id', id)
    .single()

  if (punch) {
    // Recompute the derived entry from the day's punches (source of truth).
    // Central calendar day, not UTC (TS4).
    const date = centralDate(punch.punched_at)
    await recomputeDayEntry(createAdminClient(), punch.employee_id, date)
  }

  return NextResponse.json({ punch: data })
}
