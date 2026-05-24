import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const assignTo: string | null =
    body.assigned_to === null ? null : body.assigned_to || null

  // Permission check: role=admin, can_admin_hub, OR can_assign_txt_threads
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_hub, can_assign_txt_threads')
    .eq('id', user.id)
    .single()

  const canAssign =
    profile?.role === 'admin' ||
    profile?.can_admin_hub === true ||
    profile?.can_assign_txt_threads === true

  // Self-assign (claiming an unassigned thread) is always allowed
  const isSelfClaim = assignTo === user.id

  if (!canAssign && !isSelfClaim) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const newStatus = assignTo ? 'assigned' : 'unassigned'

  const { data: updated, error } = await admin
    .from('txt_conversations')
    .update({ assigned_to: assignTo, status: newStatus })
    .eq('id', id)
    .select('id, status, assigned_to')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message || 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, conversation: updated })
}
