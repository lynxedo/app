import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const COLUMNS =
  'id, name, phone, email, lead_comments, service, lead_source, status, lead_creation_date, annual_value, sold_date, salesperson, base_program_sold, auxiliary_services, cancelled_status, cancellation_reason, cancel_date, temp_updated, temp_prepaid, monday_group, created_at, updated_at'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') ?? ''
  const group = searchParams.get('group') ?? ''
  const cancelled = searchParams.get('cancelled') ?? ''
  const salesperson = searchParams.get('salesperson') ?? ''

  let query = supabase
    .from('recurring_services')
    .select(COLUMNS)
    .order('name', { ascending: true })

  if (group) query = query.eq('monday_group', group)
  if (cancelled) query = query.eq('cancelled_status', cancelled)
  if (salesperson) query = query.eq('salesperson', salesperson)
  if (search) {
    query = query.or(
      `name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`
    )
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id) return NextResponse.json({ error: 'No company' }, { status: 403 })

  const body = await request.json()

  const { data, error } = await supabase
    .from('recurring_services')
    .insert({ ...body, company_id: profile.company_id, source: 'manual' })
    .select(COLUMNS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
