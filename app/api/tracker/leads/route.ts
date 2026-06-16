import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchLeadsWithNotes } from '@/lib/tracker/leads'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  try {
    const result = await fetchLeadsWithNotes(supabase, {
      search: searchParams.get('search') ?? '',
      stage: searchParams.get('stage') ?? '',
      status: searchParams.get('status') ?? '',
      salesperson: searchParams.get('salesperson') ?? '',
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
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
