import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTxtConvPermissions } from '@/lib/txt-permissions'

// POST /api/txt/conversations/[id]/archive — body { archived: true|false }
//
// Only the owner or a Txt manager can archive. Members and read-only
// teammates cannot — archiving for everyone is owner-level.
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

  const perms = await getTxtConvPermissions(supabase, id, user.id)
  if (!perms.canArchive) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: conv } = await supabase
    .from('txt_conversations')
    .select('assigned_to, status')
    .eq('id', id)
    .single()

  const admin = createAdminClient()
  const update = archived
    ? { status: 'archived' as const, archived_by: user.id }
    : {
        status: (conv?.assigned_to ? 'assigned' : 'unassigned') as 'assigned' | 'unassigned',
        archived_by: null,
      }

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
