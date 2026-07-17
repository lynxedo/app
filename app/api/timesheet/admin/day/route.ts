import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recomputeDayEntry, validatePunchPair } from '@/lib/timesheet-recompute'
import { centralDayRangeUtc } from '@/lib/timezone'

// PATCH /api/timesheet/admin/day
// Body: { employee_id, date (YYYY-MM-DD), clock_in (ISO), clock_out (ISO), edit_reason }
//
// Edits one day's shift. Punches are the source of truth, so this updates the
// day's IN punch + OUT punch (creating either if missing), then recomputes the
// derived time_entries row. Validates clock_out > clock_in server-side so an
// inverted shift can never be saved (the 3:40am-instead-of-3:40pm bug).
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && !profile?.can_admin_timesheet) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { employee_id, date, clock_in, clock_out, edit_reason } = await req.json()
  if (!employee_id || !date || !clock_in || !clock_out) {
    return NextResponse.json({ error: 'employee_id, date, clock_in and clock_out are required' }, { status: 400 })
  }
  if (!edit_reason?.trim()) {
    return NextResponse.json({ error: 'A reason for the edit is required' }, { status: 400 })
  }

  // Server-side guard — never persist an inverted or impossible shift.
  const validationError = validatePunchPair(clock_in, clock_out)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const admin = createAdminClient()

  // Track 1 — the admin client bypasses RLS: verify the target employee belongs
  // to the caller's company before reading or writing any punches.
  if (!profile?.company_id) return NextResponse.json({ error: 'No company' }, { status: 403 })
  const { data: targetEmployee } = await admin
    .from('employees')
    .select('id')
    .eq('id', employee_id)
    .eq('company_id', profile.company_id)
    .single()
  if (!targetEmployee) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Load the day's existing punches to update in place (preserves ids + audit).
  // Central calendar day, not UTC (TS4).
  const { startIso, endIso } = centralDayRangeUtc(date)
  const { data: dayPunches } = await admin
    .from('time_punches')
    .select('id, punch_type, punched_at, original_punched_at')
    .eq('employee_id', employee_id)
    .gte('punched_at', startIso)
    .lt('punched_at', endIso)
    .order('punched_at', { ascending: true })

  const ins = (dayPunches ?? []).filter((p: { punch_type: string }) => p.punch_type === 'in')
  const outs = (dayPunches ?? []).filter((p: { punch_type: string }) => p.punch_type === 'out')
  const inPunch = ins[0]
  const outPunch = outs.length > 0 ? outs[outs.length - 1] : null

  // Update or create the IN punch.
  if (inPunch) {
    await admin.from('time_punches').update({
      punched_at: clock_in,
      edit_reason: edit_reason.trim(),
      edited_by: user.id,
      original_punched_at: inPunch.original_punched_at ?? inPunch.punched_at,
    }).eq('id', inPunch.id)
  } else {
    await admin.from('time_punches').insert({
      employee_id, punch_type: 'in', punched_at: clock_in,
      edit_reason: edit_reason.trim(), edited_by: user.id,
    })
  }

  // Update or create the OUT punch.
  if (outPunch) {
    await admin.from('time_punches').update({
      punched_at: clock_out,
      edit_reason: edit_reason.trim(),
      edited_by: user.id,
      original_punched_at: outPunch.original_punched_at ?? outPunch.punched_at,
    }).eq('id', outPunch.id)
  } else {
    await admin.from('time_punches').insert({
      employee_id, punch_type: 'out', punched_at: clock_out,
      edit_reason: edit_reason.trim(), edited_by: user.id,
    })
  }

  const result = await recomputeDayEntry(admin, employee_id, date)
  return NextResponse.json({ ok: true, ...result })
}
