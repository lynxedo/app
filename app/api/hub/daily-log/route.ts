import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date') // YYYY-MM-DD
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 })

  const { data: entries, error } = await supabase
    .from('daily_log_entries')
    .select(`
      id, log_date, office_notes, route_sheet_url, route_sheet_name, created_at,
      tech:hub_users!tech_user_id(id, display_name, avatar_url),
      creator:hub_users!created_by(id, display_name),
      updates:daily_log_updates(id, content, created_at, created_by, creator:hub_users!created_by(id, display_name, avatar_url))
    `)
    .eq('company_id', profile.company_id)
    .eq('log_date', date)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Sort updates within each entry by created_at
  const sorted = (entries ?? []).map(e => ({
    ...e,
    updates: [...(e.updates ?? [])].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ),
  }))

  return NextResponse.json({ entries: sorted })
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
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { log_date, tech_user_id, office_notes } = await request.json()
  if (!log_date || !tech_user_id) {
    return NextResponse.json({ error: 'log_date and tech_user_id required' }, { status: 400 })
  }

  const { data: entry, error } = await supabase
    .from('daily_log_entries')
    .insert({
      company_id: profile.company_id,
      log_date,
      tech_user_id,
      office_notes: office_notes?.trim() || null,
      created_by: user.id,
    })
    .select(`
      id, log_date, office_notes, route_sheet_url, route_sheet_name, created_at,
      tech:hub_users!tech_user_id(id, display_name, avatar_url),
      creator:hub_users!created_by(id, display_name)
    `)
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'An entry for this tech already exists for this date' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ...entry, updates: [] }, { status: 201 })
}
