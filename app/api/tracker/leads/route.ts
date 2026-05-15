import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') ?? ''
  const stage = searchParams.get('stage') ?? ''
  const status = searchParams.get('status') ?? ''
  const salesperson = searchParams.get('salesperson') ?? ''

  let query = supabase
    .from('leads')
    .select('id, first_name, last_name, phone, email, service, lead_source, status, stage, lead_creation_date, sold_date, salesperson, base_program_sold, auxiliary_services, annual_value, service_address, created_at, updated_at')
    .order('created_at', { ascending: false })

  if (stage) query = query.eq('stage', stage)
  if (status) query = query.eq('status', status)
  if (salesperson) query = query.eq('salesperson', salesperson)
  if (search) {
    query = query.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`
    )
  }

  const { data: leads, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!leads || leads.length === 0) return NextResponse.json([])

  // Fetch latest note per lead
  const leadIds = leads.map(l => l.id)
  const { data: notes } = await supabase
    .from('lead_notes')
    .select('lead_id, note, created_by, created_at')
    .in('lead_id', leadIds)
    .order('created_at', { ascending: false })

  const latestNoteMap = new Map<string, { note: string; created_by: string; created_at: string }>()
  for (const n of notes ?? []) {
    if (!latestNoteMap.has(n.lead_id)) {
      latestNoteMap.set(n.lead_id, { note: n.note, created_by: n.created_by, created_at: n.created_at })
    }
  }

  const result = leads.map(l => ({ ...l, latest_note: latestNoteMap.get(l.id) ?? null }))
  return NextResponse.json(result)
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
  const { initial_note, ...leadFields } = body

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({ ...leadFields, company_id: profile.company_id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (initial_note?.trim()) {
    await supabase.from('lead_notes').insert({
      lead_id: lead.id,
      company_id: profile.company_id,
      note: initial_note.trim(),
      created_by: user.email?.split('@')[0] ?? 'unknown',
    })
  }

  return NextResponse.json(lead)
}
