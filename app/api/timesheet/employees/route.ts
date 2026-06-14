import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: activeEmps, error } = await supabase
    .from('employees')
    .select('*')
    .eq('is_active', true)
    .order('first_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const employees = [...(activeEmps ?? [])]

  // TS11 — when a pay period is supplied, also include INACTIVE employees who
  // have time entries in that window. A deactivated employee's final week would
  // otherwise drop out of the pay-period table + Gusto CSV entirely.
  const periodStart = req.nextUrl.searchParams.get('period_start')
  const periodEnd = req.nextUrl.searchParams.get('period_end')
  if (periodStart && periodEnd) {
    const { data: entryRows } = await supabase
      .from('time_entries')
      .select('employee_id')
      .gte('date', periodStart)
      .lte('date', periodEnd)
    const activeIds = new Set(employees.map(e => e.id))
    const missingIds = [...new Set((entryRows ?? []).map(r => r.employee_id))]
      .filter(id => id && !activeIds.has(id))
    if (missingIds.length > 0) {
      const { data: inactiveEmps } = await supabase
        .from('employees')
        .select('*')
        .in('id', missingIds)
        .order('first_name')
      for (const e of inactiveEmps ?? []) employees.push(e)
    }
  }

  return NextResponse.json({ employees })
}

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
  const { first_name, last_name, preferred_name, email, phone, job_title, department, pay_type, hourly_rate } = body

  if (!first_name || !last_name) return NextResponse.json({ error: 'First and last name required' }, { status: 400 })
  if (!pay_type || !['hourly', 'salary'].includes(pay_type)) return NextResponse.json({ error: 'pay_type must be hourly or salary' }, { status: 400 })

  const { data, error } = await supabase
    .from('employees')
    .insert({
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      preferred_name: preferred_name?.trim() || null,
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      job_title: job_title?.trim() || null,
      department: department?.trim() || null,
      pay_type,
      flsa_status: pay_type === 'salary' ? 'Exempt' : 'Nonexempt',
      hourly_rate: pay_type === 'hourly' && hourly_rate ? parseFloat(hourly_rate) : null,
      is_active: true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ employee: data })
}
