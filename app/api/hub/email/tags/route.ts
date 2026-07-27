import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxUserFlags } from '@/lib/inbox/permissions'

export const dynamic = 'force-dynamic'

// Shared Inbox tags — admin-managed tag DEFINITIONS (two kinds: 'type' = what an
// email IS; 'outcome' = what happened / what's next). inbox_tags is service-role
// only (no RLS policies), so every read/write goes through the admin client after
// the gate.
//   • GET  — any inbox user (so the UI can render chips + the apply picker).
//   • POST — Integrations admins only (same gate that manages the mailbox itself).

const KINDS = ['type', 'outcome'] as const
type TagKind = (typeof KINDS)[number]

// Accept #rgb / #rrggbb / #rrggbbaa. The panel's color picker always sends valid
// hex; this guards against junk reaching the chip renderer.
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

export type InboxTag = {
  id: string
  company_id: string
  kind: TagKind
  name: string
  color: string
  outlook_category: string | null
  sort_order: number
  active: boolean
}

const TAG_COLUMNS = 'id, company_id, kind, name, color, outlook_category, sort_order, active'

// GET /api/hub/email/tags — all of this company's tags (active AND inactive, so
// historical chips on already-tagged threads still resolve; the client filters to
// active for the apply picker). Ordered by kind, then the admin's sort order.
export async function GET() {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId, companyId } = auth

  const admin = createAdminClient()
  // Read flags via the admin client for reliability regardless of RLS timing
  // (mirrors the accounts route). Any inbox user may read the tag catalog.
  const flags = await getInboxUserFlags(admin, userId)
  if (!flags.hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await admin
    .from('inbox_tags')
    .select(TAG_COLUMNS)
    .eq('company_id', companyId)
    .order('kind', { ascending: true })
    .order('sort_order', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ tags: (data ?? []) as InboxTag[] })
}

// POST /api/hub/email/tags — create a tag.
// Body: { kind:'type'|'outcome', name, color?, sort_order?, outlook_category? }
export async function POST(request: Request) {
  const check = await requireAdminArea('integrations')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const companyId = check.company_id

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!(KINDS as readonly string[]).includes(body.kind)) {
    return NextResponse.json({ error: `kind must be one of: ${KINDS.join(', ')}` }, { status: 400 })
  }
  const kind = body.kind as TagKind

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Tag name is required' }, { status: 400 })

  // Optional color — validate so only real hex reaches the chip renderer; omit to
  // let the table default (#64748b) apply.
  let color: string | undefined
  if (body.color !== undefined && body.color !== null && body.color !== '') {
    const c = typeof body.color === 'string' ? body.color.trim() : ''
    if (!HEX_RE.test(c)) {
      return NextResponse.json({ error: 'color must be a hex color like #2563eb' }, { status: 400 })
    }
    color = c
  }

  // Optional Outlook category to mirror (Decision J); null → the tag name is used.
  let outlookCategory: string | null = null
  if (typeof body.outlook_category === 'string' && body.outlook_category.trim()) {
    outlookCategory = body.outlook_category.trim()
  }

  const admin = createAdminClient()

  // Default sort_order = append to the end of THIS kind's list.
  let sortOrder: number
  if (typeof body.sort_order === 'number' && Number.isFinite(body.sort_order)) {
    sortOrder = Math.trunc(body.sort_order)
  } else {
    const { data: last } = await admin
      .from('inbox_tags')
      .select('sort_order')
      .eq('company_id', companyId)
      .eq('kind', kind)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    sortOrder = ((last?.sort_order as number | undefined) ?? 0) + 1
  }

  const insert: Record<string, unknown> = {
    company_id: companyId,
    kind,
    name,
    outlook_category: outlookCategory,
    sort_order: sortOrder,
  }
  if (color) insert.color = color

  const { data: created, error } = await admin
    .from('inbox_tags')
    .insert(insert)
    .select(TAG_COLUMNS)
    .single()
  if (error) {
    // Unique (company_id, kind, name) violation → friendly 409.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A tag with that name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ tag: created as InboxTag })
}
