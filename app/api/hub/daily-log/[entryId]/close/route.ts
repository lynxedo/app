import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// POST = mark closed (office review done)
// DELETE = un-mark closed
//
// Allowed for: anyone in the entry's company. Closing is a lightweight
// "office reviewed it" flag and is freely reversible, so the whole team can
// toggle it. Cross-company access is still blocked (company match required).
// Does NOT fire a DM (per spec — office check is silent).

async function authorize(userId: string, entryId: string) {
  const supabase = await createClient()
  const [{ data: profile }, { data: entry }] = await Promise.all([
    supabase.from('user_profiles').select('company_id').eq('id', userId).single(),
    supabase.from('daily_log_entries').select('company_id').eq('id', entryId).single(),
  ])
  return Boolean(profile?.company_id) && profile?.company_id === entry?.company_id
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { entryId } = await params

  if (!(await authorize(user.id, entryId))) {
    return NextResponse.json({ error: 'Not authorized to close entries' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('daily_log_entries')
    .update({ closed_at: new Date().toISOString(), closed_by: user.id })
    .eq('id', entryId)
    .select('id, closed_at, closed_by')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(updated)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { entryId } = await params

  if (!(await authorize(user.id, entryId))) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('daily_log_entries')
    .update({ closed_at: null, closed_by: null })
    .eq('id', entryId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
