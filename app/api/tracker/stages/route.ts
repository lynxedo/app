import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('tracker_stages')
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

  const { label, color } = await request.json()
  if (!label?.trim()) return NextResponse.json({ error: 'Label required' }, { status: 400 })

  // Generate a slug key from the label
  let key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  if (!key) key = 'stage'

  // Find the current max sort_order so new stage goes at the end
  const { data: existing } = await supabase
    .from('tracker_stages')
    .select('key, sort_order')
    .eq('company_id', profile.company_id)
    .order('sort_order', { ascending: false })
    .limit(1)

  const maxOrder = existing?.[0]?.sort_order ?? -1

  // Ensure key uniqueness
  const { data: keyCheck } = await supabase
    .from('tracker_stages')
    .select('key')
    .eq('company_id', profile.company_id)
    .like('key', `${key}%`)

  if (keyCheck && keyCheck.some(r => r.key === key)) {
    key = `${key}_${keyCheck.length}`
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('tracker_stages')
    .insert({
      company_id: profile.company_id,
      key,
      label: label.trim(),
      color: color ?? '#6b7280',
      sort_order: maxOrder + 1,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
