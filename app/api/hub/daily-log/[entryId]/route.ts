import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyDailyLogComplete } from '@/lib/daily-log-notify'

type EntryAuth = {
  id: string
  company_id: string
  tech_user_id: string
  created_by: string | null
  secondary_tech_user_ids: string[] | null
}

// DL3 — verify the caller may edit/delete this entry: same company AND
// (admin / daily-log admin / the primary tech / a secondary tech / the creator).
async function authorizeEntry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  entryId: string,
): Promise<{ ok: true; entry: EntryAuth } | { ok: false; status: number; error: string }> {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_admin_daily_log')
    .eq('id', userId)
    .single()
  if (!profile?.company_id) return { ok: false, status: 403, error: 'No company' }

  const { data: entry } = await supabase
    .from('daily_log_entries')
    .select('id, company_id, tech_user_id, created_by, secondary_tech_user_ids')
    .eq('id', entryId)
    .is('deleted_at', null)
    .single()
  if (!entry) return { ok: false, status: 404, error: 'Entry not found' }
  if (entry.company_id !== profile.company_id) return { ok: false, status: 403, error: 'Forbidden' }

  const isManager = profile.role === 'admin' || profile.can_admin_daily_log === true
  const isOwner =
    entry.tech_user_id === userId ||
    entry.created_by === userId ||
    (entry.secondary_tech_user_ids ?? []).includes(userId)
  if (!isManager && !isOwner) return { ok: false, status: 403, error: 'Forbidden' }

  return { ok: true, entry: entry as EntryAuth }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { entryId } = await params

  const auth = await authorizeEntry(supabase, user.id, entryId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json()

  const updates: Record<string, unknown> = {}
  if ('office_notes' in body) updates.office_notes = body.office_notes?.trim() || null
  if ('route_sheet_url' in body) updates.route_sheet_url = body.route_sheet_url
  if ('route_sheet_name' in body) updates.route_sheet_name = body.route_sheet_name

  if ('secondary_tech_user_ids' in body) {
    const result = normalizeSecondaries(body.secondary_tech_user_ids, auth.entry.tech_user_id)
    if (result instanceof Error) {
      return NextResponse.json({ error: result.message }, { status: 400 })
    }
    updates.secondary_tech_user_ids = result
  }

  const { data, error } = await supabase
    .from('daily_log_entries')
    .update(updates)
    .eq('id', entryId)
    .select('id, office_notes, route_sheet_url, route_sheet_name, secondary_tech_user_ids, completed_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // If the entry is already complete and a content field changed, re-fire the DM
  const contentChanged =
    'office_notes' in body ||
    'route_sheet_url' in body ||
    'route_sheet_name' in body ||
    'secondary_tech_user_ids' in body
  if (data?.completed_at && contentChanged) {
    notifyDailyLogComplete(entryId).catch((err) =>
      console.error('[daily-log] re-notify on edit failed:', err),
    )
  }

  return NextResponse.json(data)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { entryId } = await params

  const auth = await authorizeEntry(supabase, user.id, entryId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // DL3 — soft delete (was a hard cascade delete). Authorized above; use the
  // admin client for the write so the new deleted_at column isn't gated by an
  // UPDATE RLS policy. Soft-deleted entries are filtered out of the list view.
  const admin = createAdminClient()
  const { error } = await admin
    .from('daily_log_entries')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', entryId)
    .is('deleted_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

function normalizeSecondaries(input: unknown, primaryId: string): string[] | Error {
  if (input == null) return []
  if (!Array.isArray(input)) return new Error('secondary_tech_user_ids must be an array')
  const ids = input.filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (ids.includes(primaryId)) return new Error('Primary tech cannot also be a secondary tech')
  const unique = [...new Set(ids)]
  if (unique.length !== ids.length) return new Error('Duplicate secondary techs')
  return unique
}
