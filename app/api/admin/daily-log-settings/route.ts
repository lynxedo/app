import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const check = await requireAdminArea('daily_log')
  if (!check.ok || !check.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id }
}

export async function GET() {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('daily_log_settings')
    .select('*')
    .eq('company_id', ctx.companyId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}

export async function POST(request: Request) {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rawUsers = body.completion_notify_user_ids
  const rawRooms = body.completion_notify_room_ids
  const rawUpdateUsers = body.update_notify_user_ids
  if (!Array.isArray(rawUsers)) {
    return NextResponse.json(
      { error: 'completion_notify_user_ids must be an array' },
      { status: 400 },
    )
  }
  if (rawRooms !== undefined && !Array.isArray(rawRooms)) {
    return NextResponse.json(
      { error: 'completion_notify_room_ids must be an array' },
      { status: 400 },
    )
  }
  if (rawUpdateUsers !== undefined && !Array.isArray(rawUpdateUsers)) {
    return NextResponse.json(
      { error: 'update_notify_user_ids must be an array' },
      { status: 400 },
    )
  }
  const userIds = [
    ...new Set(rawUsers.filter((v): v is string => typeof v === 'string' && v.length > 0)),
  ]
  const roomIds = [
    ...new Set(
      ((rawRooms as unknown[]) ?? []).filter(
        (v): v is string => typeof v === 'string' && v.length > 0,
      ),
    ),
  ]
  const updateUserIds = [
    ...new Set(
      ((rawUpdateUsers as unknown[]) ?? []).filter(
        (v): v is string => typeof v === 'string' && v.length > 0,
      ),
    ),
  ]

  // Optional: on_my_way_template (v2 — null = use system default)
  let onMyWayTemplate: string | null | undefined
  if ('on_my_way_template' in body) {
    const raw = body.on_my_way_template
    if (raw === null) {
      onMyWayTemplate = null
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed.length > 500) {
        return NextResponse.json({ error: 'Template too long (max 500 chars)' }, { status: 400 })
      }
      onMyWayTemplate = trimmed.length === 0 ? null : trimmed
    } else {
      return NextResponse.json({ error: 'on_my_way_template must be a string or null' }, { status: 400 })
    }
  }

  const admin = createAdminClient()
  const upsertPayload: Record<string, unknown> = {
    company_id: ctx.companyId,
    completion_notify_user_ids: userIds,
    completion_notify_room_ids: roomIds,
    updated_at: new Date().toISOString(),
  }
  if (onMyWayTemplate !== undefined) {
    upsertPayload.on_my_way_template = onMyWayTemplate
  }
  // Only write the update-notify list when the caller sent it, so a payload
  // that omits the key doesn't wipe an existing list.
  if ('update_notify_user_ids' in body) {
    upsertPayload.update_notify_user_ids = updateUserIds
  }

  const { data, error } = await admin
    .from('daily_log_settings')
    .upsert(upsertPayload, { onConflict: 'company_id' })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
