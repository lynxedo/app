import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

// PATCH /api/admin/dialer/ring-groups/[id]
// Body: { name?, ring_mode?, ring_timeout_sec?, member_user_ids? }
// member_user_ids replaces the full member list in the order given (position
// is index in the array — meaningful for sequential mode).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = await requireAdminArea('dialer')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const { id } = await params
  const body = await request.json().catch(() => null)
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const admin = createAdminClient()

  // Verify the group belongs to caller's company.
  const { data: group } = await admin
    .from('dialer_ring_groups')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!group || group.company_id !== check.company_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = {}
  if (typeof body?.name === 'string') updates.name = body.name.trim()
  if (body?.ring_mode === 'sequential' || body?.ring_mode === 'simultaneous') {
    updates.ring_mode = body.ring_mode
  }
  if (body?.ring_timeout_sec !== undefined) {
    const t = parseInt(body.ring_timeout_sec, 10)
    if (Number.isFinite(t)) {
      updates.ring_timeout_sec = Math.max(5, Math.min(120, t))
    }
  }
  updates.updated_at = new Date().toISOString()

  if (Object.keys(updates).length > 1) {
    const { error: updErr } = await admin
      .from('dialer_ring_groups')
      .update(updates)
      .eq('id', id)
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }
  }

  // Members rewrite if provided.
  if (Array.isArray(body?.member_user_ids)) {
    const memberIds: string[] = body.member_user_ids.filter(
      (x: unknown): x is string => typeof x === 'string'
    )
    const { data: validUsers } = await admin
      .from('user_profiles')
      .select('id')
      .eq('company_id', check.company_id)
      .in('id', memberIds.length > 0 ? memberIds : ['00000000-0000-0000-0000-000000000000'])
    const validSet = new Set((validUsers ?? []).map((u) => u.id))
    const rows = memberIds
      .filter((mid) => validSet.has(mid))
      .map((mid, idx) => ({
        group_id: id,
        user_id: mid,
        position: idx,
        member_timeout_sec: 20,
      }))

    await admin.from('dialer_ring_group_members').delete().eq('group_id', id)
    if (rows.length > 0) {
      const { error: memErr } = await admin
        .from('dialer_ring_group_members')
        .insert(rows)
      if (memErr) {
        return NextResponse.json({ error: memErr.message }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/dialer/ring-groups/[id]
// Cascades members via FK. IVR actions referencing this id will fall through
// to the company general voicemail on next inbound call (ringGroupUrlFor →
// route → group lookup miss → general VM Redirect). Documented behavior.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = await requireAdminArea('dialer')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const { id } = await params
  const admin = createAdminClient()

  const { data: group } = await admin
    .from('dialer_ring_groups')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!group || group.company_id !== check.company_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { error: delErr } = await admin
    .from('dialer_ring_groups')
    .delete()
    .eq('id', id)
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
