import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
    // Find the matching in/out pair and recompute
    const date = new Date(punch.punched_at).toISOString().split('T')[0]
    const { data: dayPunches } = await supabase
      .from('time_punches')
      .select('*')
      .eq('employee_id', punch.employee_id)
      .gte('punched_at', date + 'T00:00:00Z')
      .lte('punched_at', date + 'T23:59:59Z')
      .order('punched_at', { ascending: true })

    if (dayPunches && dayPunches.length >= 2) {
      const inPunch = dayPunches.find((p: { punch_type: string }) => p.punch_type === 'in')
      const outPunch = dayPunches.find((p: { punch_type: string }) => p.punch_type === 'out')
      if (inPunch && outPunch) {
        const clockIn = new Date(inPunch.punched_at)
        const clockOut = new Date(outPunch.punched_at)
        const totalHours = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / 3600000)
        const regularHours = Math.min(totalHours, 8)
        const overtimeHours = Math.max(0, totalHours - 8)

        await supabase
          .from('time_entries')
          .update({
            clock_in: clockIn.toISOString(),
            clock_out: clockOut.toISOString(),
            total_hours: Math.round(totalHours * 100) / 100,
            regular_hours: Math.round(regularHours * 100) / 100,
            overtime_hours: Math.round(overtimeHours * 100) / 100,
            updated_at: new Date().toISOString(),
          })
          .eq('employee_id', punch.employee_id)
          .eq('date', date)
      }
    }
  }

  return NextResponse.json({ punch: data })
}
