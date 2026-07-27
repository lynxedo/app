import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxUserFlags } from '@/lib/inbox/permissions'

export const dynamic = 'force-dynamic'

// Shared Inbox saved views — PER-USER pinned filters (Txt-style lenses). Each row
// is a named snapshot of the inbox filter state (scope/tag/waiting/folder/search/
// snoozed) that ONLY its author sees. inbox_saved_views is service-role only (no
// RLS policies), so every read/write goes through the admin client after the gate
// AND is scoped by user_id = <caller> — a user can only ever see/touch their own.
//   • GET  — the caller's own views (any inbox user with access).
//   • POST — create one of the caller's own views.

export type InboxSavedView = {
  id: string
  name: string
  config: Record<string, unknown>
  sort_order: number
}

const VIEW_COLUMNS = 'id, name, config, sort_order'

// GET /api/hub/email/saved-views — the CALLER's own saved views, ordered by their
// chosen sort_order then creation time.
export async function GET() {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId } = auth

  const admin = createAdminClient()
  // Any inbox user with access may manage their own views. Read the flag via the
  // admin client for reliability regardless of RLS timing (mirrors the tags route).
  const flags = await getInboxUserFlags(admin, userId)
  if (!flags.hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await admin
    .from('inbox_saved_views')
    .select(VIEW_COLUMNS)
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ views: (data ?? []) as InboxSavedView[] })
}

// POST /api/hub/email/saved-views — create a saved view for the caller.
// Body: { name, config? }
export async function POST(request: Request) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId, companyId } = auth

  const admin = createAdminClient()
  const flags = await getInboxUserFlags(admin, userId)
  if (!flags.hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'View name is required' }, { status: 400 })

  // config is a free-form filter snapshot; default to {} when omitted. Reject
  // anything that isn't a plain object (arrays/null included).
  let config: Record<string, unknown> = {}
  if (body.config !== undefined && body.config !== null) {
    if (typeof body.config !== 'object' || Array.isArray(body.config)) {
      return NextResponse.json({ error: 'config must be an object' }, { status: 400 })
    }
    config = body.config as Record<string, unknown>
  }

  // Default sort_order = append to the end of THIS user's list.
  const { data: last } = await admin
    .from('inbox_saved_views')
    .select('sort_order')
    .eq('user_id', userId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const sortOrder = ((last?.sort_order as number | undefined) ?? 0) + 1

  const { data: created, error } = await admin
    .from('inbox_saved_views')
    .insert({
      company_id: companyId,
      user_id: userId,
      name,
      config,
      sort_order: sortOrder,
    })
    .select(VIEW_COLUMNS)
    .single()
  if (error) {
    // Unique (user_id, name) violation → friendly 409.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A view with that name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ view: created as InboxSavedView })
}
