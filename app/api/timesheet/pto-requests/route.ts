import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/timesheet/pto-requests?start=YYYY-MM-DD&end=YYYY-MM-DD
// Employee: their own requests. Admin: all for the company in date range.
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
  const url = new URL(req.url)
  const start = url.searchParams.get('start')
  const end = url.searchParams.get('end')

  if (isAdmin) {
    let query = supabase
      .from('pto_requests')
      .select('*, employees(id, first_name, last_name, preferred_name)')
      .eq('company_id', profile!.company_id)
      .order('created_at', { ascending: false })

    if (start) query = query.gte('request_date', start)
    if (end) query = query.lte('request_date', end)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ requests: data })
  }

  // Non-admin: own requests only
  const { data: emp } = await supabase
    .from('employees')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (!emp) return NextResponse.json({ requests: [] })

  let query = supabase
    .from('pto_requests')
    .select('*')
    .eq('employee_id', emp.id)
    .order('request_date', { ascending: false })
    .limit(100)

  if (start) query = query.gte('request_date', start)
  if (end) query = query.lte('request_date', end)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requests: data })
}

// POST /api/timesheet/pto-requests — employee submits a PTO request
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: emp } = await supabase
    .from('employees')
    .select('id, company_id')
    .eq('user_id', user.id)
    .single()
  if (!emp) return NextResponse.json({ error: 'No linked employee record' }, { status: 403 })

  const body = await req.json()
  const { request_date, hours, type, note } = body

  if (!request_date) return NextResponse.json({ error: 'Date required' }, { status: 400 })
  if (!hours || Number(hours) <= 0) return NextResponse.json({ error: 'Hours must be > 0' }, { status: 400 })
  if (!['paid', 'unpaid'].includes(type)) {
    return NextResponse.json({ error: 'Type must be paid or unpaid' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('pto_requests')
    .insert({
      company_id: emp.company_id,
      employee_id: emp.id,
      request_date,
      hours: Number(hours),
      type,
      note: note?.trim() || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ request: data })
}
