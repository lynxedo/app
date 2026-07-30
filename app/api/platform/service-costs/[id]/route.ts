import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePlatformAdmin } from '@/lib/platform-auth'

const EDITABLE = ['category', 'service', 'plan', 'monthly', 'usage', 'notes', 'sort_order', 'active']

// PATCH — edit one service-cost row. Body: any editable field(s).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  const { id } = await params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const updates: Record<string, unknown> = {}
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields.' }, { status: 400 })
  }
  updates.updated_at = new Date().toISOString()
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('platform_service_costs')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ service: data })
}

// DELETE — remove one service-cost row.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  const { id } = await params
  const admin = createAdminClient()
  const { error } = await admin.from('platform_service_costs').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
