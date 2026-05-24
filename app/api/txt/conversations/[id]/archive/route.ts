import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/txt/conversations/[id]/archive — body { archived: true|false }
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
  const archived: boolean = body.archived !== false

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_hub, can_assign_txt_threads')
    .eq('id', user.id)
    .single()

  // Anyone in the company can archive/unarchive a thread they own or any thread
  // if they have the manage permission. Plain users can also archive their own.
  const { data: conv } = await supabase
    .from('txt_conversations')
    .select('assigned_to, status')
    .eq('id', id)
    .single()

  const isManager =
    profile?.role === 'admin' ||
    profile?.can_admin_hub === true ||
    profile?.can_assign_txt_threads === true
  const isOwner = conv?.assigned_to === user.id

  if (!isManager && !isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const update = archived
    ? { status: 'archived' as const }
    : { status: (conv?.assigned_to ? 'assigned' : 'unassigned') as 'assigned' | 'unassigned' }

  const { data: updated, error } = await admin
    .from('txt_conversations')
    .update(update)
    .eq('id', id)
    .select('id, status, assigned_to')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message || 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, conversation: updated })
}
