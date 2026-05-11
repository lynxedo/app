import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function getPayPeriod(date: Date): { start: string; end: string } {
  const d = new Date(date)
  const day = d.getDay()
  const daysFromMonday = day === 0 ? 6 : day - 1
  const monday = new Date(d)
  monday.setDate(d.getDate() - daysFromMonday)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0],
  }
}

function computeHours(clockIn: Date, clockOut: Date, breakMinutes = 0) {
  const totalHours = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / 3600000 - breakMinutes / 60)
  const regularHours = Math.min(totalHours, 8)
  const overtimeHours = Math.max(0, totalHours - 8)
  return {
    total_hours: Math.round(totalHours * 100) / 100,
    regular_hours: Math.round(regularHours * 100) / 100,
    overtime_hours: Math.round(overtimeHours * 100) / 100,
  }
}

// GET /api/timesheet/punch?employee_id=xxx — returns current clock-in status
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const employee_id = req.nextUrl.searchParams.get('employee_id')
  if (!employee_id) return NextResponse.json({ error: 'employee_id required' }, { status: 400 })

  // Most recent punch for this employee
  const { data: punch } = await supabase
    .from('time_punches')
    .select('*')
    .eq('employee_id', employee_id)
    .order('punched_at', { ascending: false })
    .limit(1)
    .single()

  const clocked_in = punch?.punch_type === 'in'
  return NextResponse.json({
    clocked_in,
    since: clocked_in ? punch.punched_at : null,
    last_punch: punch ?? null,
  })
}

// POST /api/timesheet/punch — clock in or out
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { employee_id, action, note, lat, lng } = body

  if (!employee_id || !action) {
    return NextResponse.json({ error: 'employee_id and action required' }, { status: 400 })
  }
  if (action !== 'in' && action !== 'out') {
    return NextResponse.json({ error: 'action must be "in" or "out"' }, { status: 400 })
  }

  // Verify permission: admin can punch for anyone, employees only for themselves
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
    const { data: emp } = await supabase
      .from('employees')
      .select('id')
      .eq('id', employee_id)
      .eq('user_id', user.id)
      .single()
    if (!emp) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Check current status
  const { data: lastPunch } = await supabase
    .from('time_punches')
    .select('*')
    .eq('employee_id', employee_id)
    .order('punched_at', { ascending: false })
    .limit(1)
    .single()

  const currentlyIn = lastPunch?.punch_type === 'in'

  if (action === 'in' && currentlyIn) {
    return NextResponse.json({ error: 'Already clocked in' }, { status: 409 })
  }
  if (action === 'out' && !currentlyIn) {
    return NextResponse.json({ error: 'Not currently clocked in' }, { status: 409 })
  }

  const now = new Date()

  // Insert the punch
  const { data: newPunch, error: punchError } = await supabase
    .from('time_punches')
    .insert({
      employee_id,
      punch_type: action,
      punched_at: now.toISOString(),
      note: note || null,
      lat: lat || null,
      lng: lng || null,
    })
    .select()
    .single()

  if (punchError) return NextResponse.json({ error: punchError.message }, { status: 500 })

  // On clock-out: compute and store the time entry
  if (action === 'out' && lastPunch) {
    const clockIn = new Date(lastPunch.punched_at)
    const hours = computeHours(clockIn, now)
    const period = getPayPeriod(clockIn)

    await supabase.from('time_entries').insert({
      employee_id,
      date: clockIn.toISOString().split('T')[0],
      clock_in: clockIn.toISOString(),
      clock_out: now.toISOString(),
      ...hours,
      pay_period_start: period.start,
      pay_period_end: period.end,
      notes: note || null,
    })
  }

  return NextResponse.json({ punch: newPunch, action })
}
