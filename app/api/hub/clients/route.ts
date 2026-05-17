import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search')?.trim() ?? ''
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100)
  const offset = parseInt(searchParams.get('offset') ?? '0')

  let query = supabase
    .from('hub_contacts')
    .select('id, name, phone, email, jobber_client_id, do_not_text, updated_at', { count: 'exact' })
    .order('name', { ascending: true })
    .range(offset, offset + limit - 1)

  if (search) {
    query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`)
  }

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ contacts: data ?? [], total: count ?? 0 })
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
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const body = await request.json()
  const { name, phone, email, jobber_client_id, notes } = body

  if (!name || !phone) {
    return NextResponse.json({ error: 'name and phone are required' }, { status: 400 })
  }

  const normalizedPhone = phone.replace(/\D/g, '')

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('hub_contacts')
    .upsert({
      company_id: profile.company_id,
      name: name.trim(),
      phone: normalizedPhone,
      email: email?.trim() ?? null,
      jobber_client_id: jobber_client_id ?? null,
      notes: notes?.trim() ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,phone' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
