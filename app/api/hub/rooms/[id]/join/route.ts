import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCompany } from '@/lib/company-auth'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Track 1 — resolve the caller's company; the admin client below bypasses RLS
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { companyId, userId } = auth

  const admin = createAdminClient()

  const { data: room } = await admin
    .from('rooms')
    .select('id, name, is_private, archived_at, company_id')
    .eq('id', id)
    .single()

  // Track 1 — a cross-company room must look nonexistent (checked before is_private so it can't leak)
  if (!room || room.archived_at || room.company_id !== companyId) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }
  if (room.is_private) return NextResponse.json({ error: 'Cannot self-join a private room — ask an admin to add you' }, { status: 403 })

  const { error } = await admin
    .from('room_members')
    .upsert({ room_id: id, user_id: userId, role: 'member' }, { onConflict: 'room_id,user_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: room.id, name: room.name, is_private: room.is_private })
}
