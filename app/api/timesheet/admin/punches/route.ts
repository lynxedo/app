import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/timesheet/admin/punches?employee_id=xxx&start=YYYY-MM-DD&end=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && !profile?.can_admin_timesheet) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const params = req.nextUrl.searchParams
  const employee_id = params.get('employee_id')
  const start = params.get('start')
  const end = params.get('end')

  let query = supabase
    .from('time_punches')
    .select('*')
    .order('punched_at', { ascending: true })

  if (employee_id) query = query.eq('employee_id', employee_id)
  if (start) query = query.gte('punched_at', start + 'T00:00:00.000Z')
  if (end) query = query.lte('punched_at', end + 'T23:59:59.999Z')

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ punches: data })
}

// POST /api/timesheet/admin/punches — admin manually adds a punch
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && !profile?.can_admin_timesheet) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { employee_id, punch_type, punched_at, note } = body

  if (!employee_id || !punch_type || !punched_at) {
    return NextResponse.json({ error: 'employee_id, punch_type, and punched_at required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('time_punches')
    .insert({ employee_id, punch_type, punched_at, note: note || null, edited_by: user.id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // If this completes an in/out pair, create the time_entry
  if (punch_type === 'out') {
    const date = new Date(punched_at).toISOString().split('T')[0]
    const { data: dayPunches } = await supabase
      .from('time_punches')
      .select('*')
      .eq('employee_id', employee_id)
      .gte('punched_at', date + 'T00:00:00Z')
      .lte('punched_at', date + 'T23:59:59Z')
      .order('punched_at', { ascending: true })

    if (dayPunches) {
      const inPunch = dayPunches.find((p: { punch_type: string }) => p.punch_type === 'in')
      const outPunch = dayPunches.find((p: { punch_type: string }) => p.punch_type === 'out')
      if (inPunch && outPunch) {
        const clockIn = new Date(inPunch.punched_at)
        const clockOut = new Date(outPunch.punched_at)
        const totalHours = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / 3600000)
        const regularHours = Math.min(totalHours, 8)
        const overtimeHours = Math.max(0, totalHours - 8)

        const day = clockIn.getDay()
        const daysFromMonday = day === 0 ? 6 : day - 1
        const monday = new Date(clockIn)
        monday.setDate(clockIn.getDate() - daysFromMonday)
        const sunday = new Date(monday)
        sunday.setDate(monday.getDate() + 6)

        await supabase.from('time_entries').upsert({
          employee_id,
          date,
          clock_in: clockIn.toISOString(),
          clock_out: clockOut.toISOString(),
          total_hours: Math.round(totalHours * 100) / 100,
          regular_hours: Math.round(regularHours * 100) / 100,
          overtime_hours: Math.round(overtimeHours * 100) / 100,
          pay_period_start: monday.toISOString().split('T')[0],
          pay_period_end: sunday.toISOString().split('T')[0],
        }, { onConflict: 'employee_id,date' })
      }
    }
  }

  return NextResponse.json({ punch: data })
}

// DELETE /api/timesheet/admin/punches?id=xxx
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && !profile?.can_admin_timesheet) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Use the service-role client for the delete: time_punches has no DELETE RLS
  // policy, so a user-session delete is silently filtered to 0 rows (no error,
  // nothing removed). The caller is already authenticated + admin-checked above.
  const admin = createAdminClient()
  const { data: deleted, error } = await admin
    .from('time_punches')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'Punch not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
