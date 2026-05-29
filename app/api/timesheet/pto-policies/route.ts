import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/timesheet/pto-policies — admin gets all PTO policies for the company
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet, company_id')
    .eq('id', user.id)
    .single()

  if (!(profile?.role === 'admin' || profile?.can_admin_timesheet)) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  void req
  const { data, error } = await supabase
    .from('pto_policies')
    .select('*')
    .eq('company_id', profile!.company_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ policies: data })
}

// POST /api/timesheet/pto-policies — admin upserts a PTO policy for an employee
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet, company_id')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id) return NextResponse.json({ error: 'No company' }, { status: 403 })
  if (!(profile.role === 'admin' || profile.can_admin_timesheet)) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const body = await req.json()
  const { employee_id, annual_hours, anniversary_date, accrual_notes } = body

  if (!employee_id) return NextResponse.json({ error: 'employee_id required' }, { status: 400 })
  if (annual_hours === undefined || annual_hours === null) {
    return NextResponse.json({ error: 'annual_hours required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('pto_policies')
    .upsert({
      company_id: profile.company_id,
      employee_id,
      annual_hours: Number(annual_hours),
      anniversary_date: anniversary_date || null,
      accrual_notes: accrual_notes?.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,employee_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ policy: data })
}
