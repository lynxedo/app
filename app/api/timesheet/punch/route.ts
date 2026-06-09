import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { broadcastPresenceForUser } from '@/lib/hub-presence-broadcast'
import { evaluateEventAutomations } from '@/lib/automations'

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
  // OT is weekly (>40h), not daily — store all shift hours as regular at entry level.
  // weekSummary() in the admin UI computes weekly OT across all entries.
  return {
    total_hours: Math.round(totalHours * 100) / 100,
    regular_hours: Math.round(totalHours * 100) / 100,
    overtime_hours: 0,
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

  // Verify permission: admin (or timesheet manager) can punch for anyone, employees only for themselves
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin' && !profile?.can_admin_timesheet) {
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

  // On clock-out: compute and store the time entry.
  // Must use the admin client — time_entries has an admin-only write RLS policy,
  // so a non-admin employee's session would silently drop the insert.
  if (action === 'out' && lastPunch) {
    const clockIn = new Date(lastPunch.punched_at)
    const hours = computeHours(clockIn, now)
    const period = getPayPeriod(clockIn)

    const admin = createAdminClient()
    await admin.from('time_entries').insert({
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

  // Smart presence: broadcast the new effective_status so Hub sidebars
  // flip the dot live without waiting for a refetch. Hourly users only —
  // salaried users don't use clock state. Best-effort, non-blocking.
  try {
    const admin = createAdminClient()
    const { data: emp } = await admin
      .from('employees')
      .select('user_id')
      .eq('id', employee_id)
      .single()
    if (emp?.user_id) await broadcastPresenceForUser(emp.user_id)
  } catch {
    // Non-fatal — broadcast is best-effort.
  }

  // Fire any clock-in/out automations (best-effort, non-blocking).
  try {
    const admin = createAdminClient()
    const { data: emp } = await admin
      .from('employees')
      .select('user_id')
      .eq('id', employee_id)
      .single()
    if (emp?.user_id) {
      const [{ data: prof }, { data: hu }] = await Promise.all([
        admin.from('user_profiles').select('company_id').eq('id', emp.user_id).single(),
        admin.from('hub_users').select('display_name').eq('id', emp.user_id).maybeSingle(),
      ])
      if (prof?.company_id) {
        void evaluateEventAutomations({
          companyId: prof.company_id,
          source: 'clock_event',
          actorUserId: emp.user_id,
          vars: {
            tech_name: hu?.display_name ?? '',
            event: action === 'in' ? 'clocked in' : 'clocked out',
            time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }),
            date: now.toISOString().slice(0, 10),
          },
          filter: { event: action },
        })
      }
    }
  } catch {
    // Non-fatal — automations are best-effort.
  }

  return NextResponse.json({ punch: newPunch, action })
}
