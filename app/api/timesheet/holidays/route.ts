import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/timesheet/holidays?start=YYYY-MM-DD&end=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const start = url.searchParams.get('start')
  const end = url.searchParams.get('end')

  let query = supabase
    .from('paid_holidays')
    .select('*')
    .order('date', { ascending: true })

  if (start) query = query.gte('date', start)
  if (end) query = query.lte('date', end)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ holidays: data })
}

// POST /api/timesheet/holidays — admin creates a paid holiday
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
  const { name, date, hours } = body
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  if (!date) return NextResponse.json({ error: 'Date required' }, { status: 400 })
  if (!hours || Number(hours) <= 0) return NextResponse.json({ error: 'Hours must be > 0' }, { status: 400 })

  const { data, error } = await supabase
    .from('paid_holidays')
    .insert({ company_id: profile.company_id, name: name.trim(), date, hours: Number(hours), is_active: true })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ holiday: data })
}
