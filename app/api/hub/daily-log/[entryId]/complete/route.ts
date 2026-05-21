import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyDailyLogComplete } from '@/lib/daily-log-notify'

// POST = mark complete (fires DM)
// DELETE = un-mark complete (no DM)
//
// Allowed for: primary tech, any secondary tech, admins.

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { entryId } = await params

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()

  const { data: entry } = await supabase
    .from('daily_log_entries')
    .select('id, tech_user_id, secondary_tech_user_ids, completed_at, company_id')
    .eq('id', entryId)
    .single()
  if (!entry) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })

  const isOnEntry =
    entry.tech_user_id === user.id ||
    (entry.secondary_tech_user_ids ?? []).includes(user.id)
  if (profile?.role !== 'admin' && !isOnEntry) {
    return NextResponse.json({ error: 'Not authorized to mark this entry complete' }, { status: 403 })
  }

  // Use admin client to bypass any RLS UPDATE policy gaps for techs (similar to how
  // the existing PATCH route relies on session client — completion is a narrower op
  // and we know the user is allowed).
  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('daily_log_entries')
    .update({ completed_at: new Date().toISOString(), completed_by: user.id })
    .eq('id', entryId)
    .select('id, completed_at, completed_by')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fire DM in the background (don't block the response)
  notifyDailyLogComplete(entryId).catch((err) =>
    console.error('[daily-log] notify on complete failed:', err),
  )

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

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: entry } = await supabase
    .from('daily_log_entries')
    .select('id, tech_user_id, secondary_tech_user_ids')
    .eq('id', entryId)
    .single()
  if (!entry) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })

  const isOnEntry =
    entry.tech_user_id === user.id ||
    (entry.secondary_tech_user_ids ?? []).includes(user.id)
  if (profile?.role !== 'admin' && !isOnEntry) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('daily_log_entries')
    .update({ completed_at: null, completed_by: null })
    .eq('id', entryId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
