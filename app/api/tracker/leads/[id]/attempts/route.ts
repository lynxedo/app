import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('lead_attempts')
    .select('*')
    .eq('lead_id', id)
    .order('attempt_number', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id) return NextResponse.json({ error: 'No company' }, { status: 403 })

  const { attempt_number, attempted_date, notes, contact_types } = await request.json()
  if (!attempt_number || attempt_number < 1 || attempt_number > 5) {
    return NextResponse.json({ error: 'attempt_number must be 1–5' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('lead_attempts')
    .upsert({
      lead_id: id,
      company_id: profile.company_id,
      attempt_number,
      attempted_date: attempted_date || null,
      notes: notes || null,
      contact_types: contact_types ?? { call: false, text: false, email: false },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'lead_id,attempt_number' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
