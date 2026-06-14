import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/timesheet/entries?employee_id=xxx&start=YYYY-MM-DD&end=YYYY-MM-DD
// Omit employee_id as admin to get all employees
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet')
    .eq('id', user.id)
    .single()
  const isTimesheetAdmin = profile?.role === 'admin' || profile?.can_admin_timesheet === true

  const params = req.nextUrl.searchParams
  let employee_id = params.get('employee_id')
  const start = params.get('start')
  const end = params.get('end')

  // Non-admins can only see their own entries — ignore any employee_id passed in
  if (!isTimesheetAdmin) {
    const { data: emp } = await supabase
      .from('employees')
      .select('id')
      .eq('user_id', user.id)
      .single()
    if (!emp) return NextResponse.json({ error: 'No linked employee record' }, { status: 403 })
    employee_id = emp.id
  }

  let query = supabase
    .from('time_entries')
    .select('*, employees(first_name, last_name, preferred_name, department, job_title, pay_type, flsa_status, hourly_rate)')
    .order('clock_in', { ascending: false })

  if (employee_id) query = query.eq('employee_id', employee_id)
  if (start) query = query.gte('date', start)
  if (end) query = query.lte('date', end)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Also pull any open (clocked-in, no clock_out) punches
  let openPunches: Record<string, unknown>[] = []
  if (isTimesheetAdmin || employee_id) {
    let punchQuery = supabase
      .from('time_punches')
      .select('*, employees(first_name, last_name, preferred_name)')
      .eq('punch_type', 'in')
      .order('punched_at', { ascending: false })

    if (employee_id) punchQuery = punchQuery.eq('employee_id', employee_id)

    // Only return 'in' punches that don't have a matching 'out'
    const { data: inPunches } = await punchQuery
    if (inPunches && inPunches.length > 0) {
      // Set-based: pull every 'out' punch for the same employees in ONE query,
      // then keep the latest 'out' time per employee. An 'in' punch is still
      // open iff there is no 'out' punch after it (i.e. latest out <= its time).
      const empIds = [...new Set(inPunches.map(p => p.employee_id))]
      const minInAt = inPunches.reduce(
        (min, p) => (p.punched_at < min ? p.punched_at : min),
        inPunches[0].punched_at as string
      )
      const { data: outPunches } = await supabase
        .from('time_punches')
        .select('employee_id, punched_at')
        .eq('punch_type', 'out')
        .in('employee_id', empIds)
        .gte('punched_at', minInAt)
      const latestOutByEmp = new Map<string, string>()
      for (const o of outPunches ?? []) {
        const prev = latestOutByEmp.get(o.employee_id)
        if (!prev || o.punched_at > prev) latestOutByEmp.set(o.employee_id, o.punched_at)
      }
      for (const p of inPunches) {
        const latestOut = latestOutByEmp.get(p.employee_id)
        if (!latestOut || latestOut <= p.punched_at) openPunches.push(p)
      }
    }
  }

  return NextResponse.json({ entries: data, open_punches: openPunches })
}
