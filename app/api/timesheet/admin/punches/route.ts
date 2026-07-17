import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recomputeDayEntry } from '@/lib/timesheet-recompute'
import { centralDate, centralDayRangeUtc } from '@/lib/timezone'

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
  // Filter by Central calendar days, not UTC, so the range matches what the admin
  // picked (a late-evening punch on `end` is included) (TS4).
  if (start) query = query.gte('punched_at', centralDayRangeUtc(start).startIso)
  if (end) query = query.lt('punched_at', centralDayRangeUtc(end).endIso)

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
    .select('role, can_admin_timesheet, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && !profile?.can_admin_timesheet) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { employee_id, punch_type, punched_at, note } = body

  if (!employee_id || !punch_type || !punched_at) {
    return NextResponse.json({ error: 'employee_id, punch_type, and punched_at required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Track 1 — the admin client bypasses RLS: verify the target employee belongs
  // to the caller's company before inserting a punch for them.
  if (!profile?.company_id) return NextResponse.json({ error: 'No company' }, { status: 403 })
  const { data: targetEmployee } = await admin
    .from('employees')
    .select('id')
    .eq('id', employee_id)
    .eq('company_id', profile.company_id)
    .single()
  if (!targetEmployee) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await admin
    .from('time_punches')
    .insert({ employee_id, punch_type, punched_at, note: note || null, edited_by: user.id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Recompute the derived entry for this punch's day (punches are the source of
  // truth; the entry is a rollup). Covers both completing a pair and adding a
  // stray punch. Weekly-OT policy lives in the shared helper.
  const date = centralDate(punched_at)
  await recomputeDayEntry(admin, employee_id, date)

  return NextResponse.json({ punch: data })
}

// DELETE /api/timesheet/admin/punches?id=xxx
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && !profile?.can_admin_timesheet) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Use the service-role client for the delete: time_punches has no DELETE RLS
  // policy, so a user-session delete is silently filtered to 0 rows (no error,
  // nothing removed). The caller is already authenticated + admin-checked above.
  const admin = createAdminClient()

  // Capture the punch's employee/date BEFORE deleting so we can recompute its
  // day afterward — otherwise a stale time_entries row lingers (the bug where
  // deleting a bad punch left the wrong hours showing).
  const { data: target } = await admin
    .from('time_punches')
    .select('employee_id, punched_at')
    .eq('id', id)
    .single()
  if (!target) return NextResponse.json({ error: 'Punch not found' }, { status: 404 })

  // Track 1 — the admin client bypasses RLS: the punch's employee must belong to
  // the caller's company (cross-company gets the same 404 as not-found).
  if (!profile?.company_id) return NextResponse.json({ error: 'No company' }, { status: 403 })
  const { data: targetEmployee } = await admin
    .from('employees')
    .select('id')
    .eq('id', target.employee_id)
    .eq('company_id', profile.company_id)
    .single()
  if (!targetEmployee) return NextResponse.json({ error: 'Punch not found' }, { status: 404 })

  const { data: deleted, error } = await admin
    .from('time_punches')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'Punch not found' }, { status: 404 })
  }

  if (target) {
    const date = centralDate(target.punched_at)
    await recomputeDayEntry(admin, target.employee_id, date)
  }

  return NextResponse.json({ ok: true })
}
