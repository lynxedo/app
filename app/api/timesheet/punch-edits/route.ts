import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/timesheet/punch-edits
// Employee: returns all their edit requests (all statuses)
// Admin: returns all PENDING requests for the company
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet, company_id')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin' || profile?.can_admin_timesheet === true
  void req // params unused for now

  if (isAdmin) {
    const { data, error } = await supabase
      .from('time_punch_edit_requests')
      .select('*, employees(id, first_name, last_name, preferred_name), time_entries(id, date, clock_in, clock_out)')
      .eq('company_id', profile!.company_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ requests: data })
  }

  // Non-admin: return their own requests
  const { data: emp } = await supabase
    .from('employees')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (!emp) return NextResponse.json({ requests: [] })

  const { data, error } = await supabase
    .from('time_punch_edit_requests')
    .select('*, time_entries(id, date, clock_in, clock_out)')
    .eq('employee_id', emp.id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requests: data })
}

// POST /api/timesheet/punch-edits — employee creates an edit request
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { time_entry_id, new_clock_in, new_clock_out, reason } = body

  if (!time_entry_id) return NextResponse.json({ error: 'time_entry_id required' }, { status: 400 })
  if (!reason?.trim()) return NextResponse.json({ error: 'A reason is required' }, { status: 400 })

  // Find employee linked to this user
  const { data: emp } = await supabase
    .from('employees')
    .select('id, company_id')
    .eq('user_id', user.id)
    .single()
  if (!emp) return NextResponse.json({ error: 'No linked employee record' }, { status: 403 })

  // Verify the time_entry belongs to this employee
  const { data: entry } = await supabase
    .from('time_entries')
    .select('id, employee_id, clock_out')
    .eq('id', time_entry_id)
    .eq('employee_id', emp.id)
    .single()
  if (!entry) return NextResponse.json({ error: 'Time entry not found' }, { status: 404 })
  if (!entry.clock_out) return NextResponse.json({ error: 'Cannot edit an in-progress shift' }, { status: 409 })

  // Only one pending request per entry at a time
  const { data: existing } = await supabase
    .from('time_punch_edit_requests')
    .select('id')
    .eq('time_entry_id', time_entry_id)
    .eq('status', 'pending')
    .single()
  if (existing) {
    return NextResponse.json({ error: 'A pending edit request already exists for this entry' }, { status: 409 })
  }

  const { data, error } = await supabase
    .from('time_punch_edit_requests')
    .insert({
      company_id: emp.company_id,
      employee_id: emp.id,
      time_entry_id,
      new_clock_in: new_clock_in || null,
      new_clock_out: new_clock_out || null,
      reason: reason.trim(),
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ request: data })
}
