import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCompany } from '@/lib/company-auth'

export async function GET() {
  // Track 1 — resolve the caller's company; the admin client below bypasses RLS
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { companyId, userId } = auth

  const admin = createAdminClient()

  const [{ data: rooms }, { data: memberships }] = await Promise.all([
    admin
      .from('rooms')
      .select('id, name, description, is_private')
      .eq('company_id', companyId) // Track 1 — only the caller's company's rooms
      .eq('is_private', false)
      .is('archived_at', null)
      .order('name'),
    admin
      .from('room_members')
      .select('room_id')
      .eq('user_id', userId),
  ])

  const memberRoomIds = new Set((memberships ?? []).map(m => m.room_id))

  const roomsWithStatus = (rooms ?? []).map(r => ({
    ...r,
    is_member: memberRoomIds.has(r.id),
  }))

  return NextResponse.json({ rooms: roomsWithStatus })
}
