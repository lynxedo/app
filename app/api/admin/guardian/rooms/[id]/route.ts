import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = await requireAdminArea('guardian')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: roomId } = await params

  let body: { guardian_full_access?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const next = body.guardian_full_access
  if (typeof next !== 'boolean') {
    return NextResponse.json({ error: 'guardian_full_access must be a boolean' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Verify the room belongs to the caller's company before writing.
  const { data: room } = await admin
    .from('rooms')
    .select('id, company_id')
    .eq('id', roomId)
    .maybeSingle()

  if (!room || (room as { company_id: string }).company_id !== check.company_id) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const { data, error } = await admin
    .from('rooms')
    .update({ guardian_full_access: next })
    .eq('id', roomId)
    .select('id, guardian_full_access')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ room: data })
}
