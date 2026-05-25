import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

// GET /api/admin/dialer/ring-groups
// Returns every ring group in the company with its member list.
export async function GET() {
  const check = await requireAdminArea('dialer')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const admin = createAdminClient()
  const { data: groups } = await admin
    .from('dialer_ring_groups')
    .select('id, name, ring_mode, ring_timeout_sec, created_at')
    .eq('company_id', check.company_id)
    .order('name')

  const groupIds = (groups ?? []).map((g) => g.id)
  let membersByGroup = new Map<string, Array<{ user_id: string; position: number; member_timeout_sec: number }>>()
  if (groupIds.length > 0) {
    const { data: rows } = await admin
      .from('dialer_ring_group_members')
      .select('group_id, user_id, position, member_timeout_sec')
      .in('group_id', groupIds)
      .order('position')
    for (const r of rows ?? []) {
      const arr = membersByGroup.get(r.group_id) ?? []
      arr.push({ user_id: r.user_id, position: r.position, member_timeout_sec: r.member_timeout_sec })
      membersByGroup.set(r.group_id, arr)
    }
  }

  const out = (groups ?? []).map((g) => ({
    ...g,
    members: membersByGroup.get(g.id) ?? [],
  }))
  return NextResponse.json({ rows: out })
}

// POST /api/admin/dialer/ring-groups
// Body: { name: string, ring_mode: 'simultaneous'|'sequential', ring_timeout_sec: number, member_user_ids: string[] }
// Creates a new ring group + members.
export async function POST(request: NextRequest) {
  const check = await requireAdminArea('dialer')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const body = await request.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const mode = body?.ring_mode === 'sequential' ? 'sequential' : 'simultaneous'
  const timeout = Math.max(5, Math.min(120, parseInt(body?.ring_timeout_sec, 10) || 25))
  const memberIds = Array.isArray(body?.member_user_ids)
    ? body.member_user_ids.filter((x: unknown): x is string => typeof x === 'string')
    : []

  if (!name) {
    return NextResponse.json({ error: 'name_required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: created, error: createErr } = await admin
    .from('dialer_ring_groups')
    .insert({
      company_id: check.company_id,
      name,
      ring_mode: mode,
      ring_timeout_sec: timeout,
    })
    .select('id, name, ring_mode, ring_timeout_sec')
    .single()
  if (createErr || !created) {
    return NextResponse.json({ error: createErr?.message ?? 'create_failed' }, { status: 500 })
  }

  if (memberIds.length > 0) {
    // Verify each user is in the company before insert (RLS won't catch this
    // because we're going through the admin client).
    const { data: validUsers } = await admin
      .from('user_profiles')
      .select('id')
      .eq('company_id', check.company_id)
      .in('id', memberIds)
    const validIds = new Set((validUsers ?? []).map((u) => u.id))
    const members = memberIds
      .filter((id: string) => validIds.has(id))
      .map((id: string, idx: number) => ({
        group_id: created.id,
        user_id: id,
        position: idx,
        member_timeout_sec: 20,
      }))
    if (members.length > 0) {
      const { error: memErr } = await admin
        .from('dialer_ring_group_members')
        .insert(members)
      if (memErr) {
        console.warn('[ring-groups] member insert failed', memErr)
      }
    }
  }

  return NextResponse.json({ ok: true, id: created.id })
}
