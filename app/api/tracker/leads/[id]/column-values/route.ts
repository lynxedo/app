import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { column_id, value } = await request.json()
  if (!column_id) return NextResponse.json({ error: 'column_id required' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('lead_column_values')
    .upsert({
      lead_id: id,
      company_id: profile.company_id,
      column_id,
      value: value ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'lead_id,column_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
