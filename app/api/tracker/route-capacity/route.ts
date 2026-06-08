import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const COLUMNS =
  'id, name, sync_date, job_title, client_name, service_street, service_city, service_province, service_zip, line_items, total, lawn_size, size_helper, drive_time, monday_group, created_at, updated_at'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') ?? ''

  let query = supabase
    .from('route_capacity')
    .select(COLUMNS)
    .order('name', { ascending: true })

  if (search) {
    query = query.or(
      `name.ilike.%${search}%,job_title.ilike.%${search}%,client_name.ilike.%${search}%,service_city.ilike.%${search}%`
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
    .from('route_capacity')
    .insert({ ...body, company_id: profile.company_id, source: 'manual' })
    .select(COLUMNS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
