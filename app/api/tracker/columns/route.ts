import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('tracker_column_definitions')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!profile?.company_id) return NextResponse.json({ error: 'No company' }, { status: 403 })

  const { name, type, options } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  const validTypes = ['text', 'number', 'date', 'dropdown', 'checkbox', 'phone']
  if (!validTypes.includes(type)) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  const { data: existing } = await supabase
    .from('tracker_column_definitions')
    .select('sort_order')
    .eq('company_id', profile.company_id)
    .order('sort_order', { ascending: false })
    .limit(1)

  const maxOrder = existing?.[0]?.sort_order ?? -1

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('tracker_column_definitions')
    .insert({
      company_id: profile.company_id,
      name: name.trim(),
      type,
      options: Array.isArray(options) ? options : [],
      sort_order: maxOrder + 1,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
