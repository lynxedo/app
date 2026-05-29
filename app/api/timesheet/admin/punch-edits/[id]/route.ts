import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// PATCH /api/timesheet/admin/punch-edits/[id]
// Admin approves or rejects an employee edit request.
// On approve: updates the matching time_punches rows and recalculates time_entries.
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
  if (profile?.role !== 'admin' && !profile?.can_admin_timesheet) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const { action, admin_note } = body

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 })
  }

  // Load the edit request with its time entry
  const { data: editReq } = await supabase
    .from('time_punch_edit_requests')
    .select('*, time_entries(id, employee_id, date, clock_in, clock_out)')
    .eq('id', id)
    .eq('status', 'pending')
    .single()

  if (!editReq) {
    return NextResponse.json({ error: 'Edit request not found or already resolved' }, { status: 404 })
  }

  if (action === 'approve' && editReq.time_entries) {
    const entry = editReq.time_entries as {
      id: string; employee_id: string; date: string; clock_in: string; clock_out: string | null
    }

    const newClockIn = editReq.new_clock_in
      ? new Date(editReq.new_clock_in)
      : new Date(entry.clock_in)
    const newClockOut = editReq.new_clock_out
      ? new Date(editReq.new_clock_out)
      : (entry.clock_out ? new Date(entry.clock_out) : null)

    // Find punches for this employee on this date and apply the new times
    const { data: dayPunches } = await supabase
      .from('time_punches')
      .select('*')
      .eq('employee_id', entry.employee_id)
      .gte('punched_at', entry.date + 'T00:00:00.000Z')
      .lte('punched_at', entry.date + 'T23:59:59.999Z')
      .order('punched_at', { ascending: true })

    if (dayPunches) {
      const inPunch = dayPunches.find((p: { punch_type: string }) => p.punch_type === 'in')
      const outPunch = dayPunches.find((p: { punch_type: string }) => p.punch_type === 'out')

      if (inPunch && editReq.new_clock_in) {
        await supabase.from('time_punches').update({
          punched_at: editReq.new_clock_in,
          edit_reason: editReq.reason,
          edited_by: user.id,
          original_punched_at: inPunch.original_punched_at ?? inPunch.punched_at,
        }).eq('id', inPunch.id)
      }

      if (outPunch && editReq.new_clock_out) {
        await supabase.from('time_punches').update({
          punched_at: editReq.new_clock_out,
          edit_reason: editReq.reason,
          edited_by: user.id,
          original_punched_at: outPunch.original_punched_at ?? outPunch.punched_at,
        }).eq('id', outPunch.id)
      }
    }

    // Recalculate hours and update the time_entry
    if (newClockOut) {
      const totalHours = Math.max(0, (newClockOut.getTime() - newClockIn.getTime()) / 3600000)
      const regularHours = Math.min(totalHours, 8)
      const overtimeHours = Math.max(0, totalHours - 8)

      await supabase.from('time_entries').update({
        clock_in: newClockIn.toISOString(),
        clock_out: newClockOut.toISOString(),
        total_hours: Math.round(totalHours * 100) / 100,
        regular_hours: Math.round(regularHours * 100) / 100,
        overtime_hours: Math.round(overtimeHours * 100) / 100,
      }).eq('id', entry.id)
    } else {
      await supabase.from('time_entries').update({
        clock_in: newClockIn.toISOString(),
      }).eq('id', entry.id)
    }
  }

  // Mark the request resolved
  const { data, error } = await supabase
    .from('time_punch_edit_requests')
    .update({
      status: action === 'approve' ? 'approved' : 'rejected',
      admin_note: admin_note?.trim() || null,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ request: data })
}
