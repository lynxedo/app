import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recomputeDayEntry, validatePunchPair, pairDayPunches } from '@/lib/timesheet-recompute'
import { centralDate, centralDayRangeUtc } from '@/lib/timezone'
import { weekLockError } from '@/lib/timesheet-lock'

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

  const lockError = await weekLockError(admin, profile.company_id, [date, centralDate(clock_in), centralDate(clock_out)])
  if (lockError) return NextResponse.json({ error: lockError }, { status: 409 })

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
      // Safe: the target employee was verified above to be in this company.
      company_id: profile.company_id,
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
      company_id: profile.company_id,
    })
  }

  const result = await recomputeDayEntry(admin, employee_id, date)
  return NextResponse.json({ ok: true, ...result })
}

// POST /api/timesheet/admin/day — "+ Add time" in the Pay Period view.
// Body: { employee_id, clock_in (ISO), clock_out (ISO), edit_reason }
//
// Adds one worked slice (a Clock In + Clock Out pair) in a single save, so an
// admin can never leave half a shift behind (the two-Clock-Ins bug). On a
// split-shift day the slice sits beside the day's other slices and the gap is an
// unpaid break; it may not overlap an existing slice. Days before the company
// switched to split shifts count first-in to last-out, so a second slice there
// would silently pay the gap — refused, use ✎ Edit instead.
export async function POST(req: NextRequest) {
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
  if (!profile?.company_id) return NextResponse.json({ error: 'No company' }, { status: 403 })

  const { employee_id, clock_in, clock_out, edit_reason } = await req.json()
  if (!employee_id || !clock_in || !clock_out) {
    return NextResponse.json({ error: 'employee_id, clock_in and clock_out are required' }, { status: 400 })
  }
  if (!edit_reason?.trim()) {
    return NextResponse.json({ error: 'A reason is required' }, { status: 400 })
  }
  const validationError = validatePunchPair(clock_in, clock_out)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const date = centralDate(clock_in)
  if (centralDate(clock_out) !== date) {
    return NextResponse.json({ error: 'Clock in and clock out must be on the same day.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: targetEmployee } = await admin
    .from('employees')
    .select('id')
    .eq('id', employee_id)
    .eq('company_id', profile.company_id)
    .single()
  if (!targetEmployee) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const lockError = await weekLockError(admin, profile.company_id, [date])
  if (lockError) return NextResponse.json({ error: lockError }, { status: 409 })

  const { startIso, endIso } = centralDayRangeUtc(date)
  const { data: dayPunches } = await admin
    .from('time_punches')
    .select('id, punch_type, punched_at')
    .eq('employee_id', employee_id)
    .gte('punched_at', startIso)
    .lt('punched_at', endIso)
    .order('punched_at', { ascending: true })

  if ((dayPunches ?? []).length > 0) {
    const { data: settings } = await admin
      .from('timesheet_settings')
      .select('unpaid_breaks_from')
      .eq('company_id', profile.company_id)
      .maybeSingle()
    const breaksFrom = (settings as { unpaid_breaks_from?: string | null } | null)?.unpaid_breaks_from ?? null
    if (!breaksFrom || date < breaksFrom) {
      return NextResponse.json({ error: 'This day already has a shift. Use ✎ Edit to change it.' }, { status: 409 })
    }
    const { slices, trailingIn } = pairDayPunches(dayPunches ?? [])
    const newIn = new Date(clock_in).getTime()
    const newOut = new Date(clock_out).getTime()
    const overlaps = slices.some(sl =>
      newIn < new Date(sl.out.punched_at).getTime() && newOut > new Date(sl.in.punched_at).getTime())
    if (overlaps) {
      return NextResponse.json({ error: 'That time overlaps time already on this day.' }, { status: 409 })
    }
    if (trailingIn && newOut > new Date(trailingIn.punched_at).getTime()) {
      return NextResponse.json({ error: 'They are clocked in from earlier that day with no clock-out. Fix that punch first.' }, { status: 409 })
    }
  }

  const reason = edit_reason.trim()
  const { error } = await admin.from('time_punches').insert([
    { employee_id, punch_type: 'in', punched_at: clock_in, edit_reason: reason, edited_by: user.id, company_id: profile.company_id },
    { employee_id, punch_type: 'out', punched_at: clock_out, edit_reason: reason, edited_by: user.id, company_id: profile.company_id },
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const result = await recomputeDayEntry(admin, employee_id, date)
  return NextResponse.json({ ok: true, ...result })
}
