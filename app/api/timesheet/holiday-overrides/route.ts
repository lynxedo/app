import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/timesheet/holiday-overrides?period_start=YYYY-MM-DD
// Returns all holiday overrides for the given pay period start
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const period_start = url.searchParams.get('period_start')
  if (!period_start) return NextResponse.json({ overrides: [] })

  const { data, error } = await supabase
    .from('holiday_overrides')
    .select('*')
    .eq('pay_period_start', period_start)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ overrides: data })
}

// POST /api/timesheet/holiday-overrides — admin upserts an override
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
  const { employee_id, holiday_id, pay_period_start, custom_hours, notes } = body

  if (!employee_id || !holiday_id || !pay_period_start) {
    return NextResponse.json({ error: 'employee_id, holiday_id, and pay_period_start required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('holiday_overrides')
    .upsert({
      company_id: profile.company_id,
      employee_id,
      holiday_id,
      pay_period_start,
      custom_hours: custom_hours !== null && custom_hours !== '' ? Number(custom_hours) : null,
      notes: notes?.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,employee_id,holiday_id,pay_period_start' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ override: data })
}
