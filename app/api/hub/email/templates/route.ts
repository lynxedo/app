import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxUserFlags } from '@/lib/inbox/permissions'

export const dynamic = 'force-dynamic'

// Shared Inbox templates — company-shared canned responses inserted from the
// composer. inbox_templates is service-role only (no RLS policies), so every
// read/write goes through the admin client after the gate.
//   • GET  — any inbox user (both composers need the active list).
//   • POST — Integrations admins only (same gate that manages the mailbox itself).

export type InboxTemplate = {
  id: string
  company_id: string
  name: string
  subject: string | null
  body_html: string
  sort_order: number
  active: boolean
}

const TEMPLATE_COLUMNS = 'id, company_id, name, subject, body_html, sort_order, active'

// GET /api/hub/email/templates — all of this company's templates (active AND
// inactive, so the manager panel can list them; composers filter to active
// client-side). Ordered by the admin's sort order, then name for stability.
export async function GET() {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId, companyId } = auth

  const admin = createAdminClient()
  // Read flags via the admin client for reliability regardless of RLS timing
  // (mirrors the tags route). Any inbox user may read the template catalog.
  const flags = await getInboxUserFlags(admin, userId)
  if (!flags.hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await admin
    .from('inbox_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('company_id', companyId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ templates: (data ?? []) as InboxTemplate[] })
}

// POST /api/hub/email/templates — create a template.
// Body: { name, subject?, body_html? }
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

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Template name is required' }, { status: 400 })

  // Optional subject line — blank → null (falls back to the reply/thread subject).
  const subject =
    typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : null
  // Body already comes through as HTML from the panel (plain-text → paragraphs
  // happens client-side); default the table's '' when omitted.
  const bodyHtml = typeof body.body_html === 'string' ? body.body_html : ''

  const admin = createAdminClient()

  // Default sort_order = append to the end of this company's list.
  const { data: last } = await admin
    .from('inbox_templates')
    .select('sort_order')
    .eq('company_id', companyId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const sortOrder = ((last?.sort_order as number | undefined) ?? 0) + 1

  const { data: created, error } = await admin
    .from('inbox_templates')
    .insert({
      company_id: companyId,
      name,
      subject,
      body_html: bodyHtml,
      sort_order: sortOrder,
      created_by: check.user?.id ?? null,
    })
    .select(TEMPLATE_COLUMNS)
    .single()
  if (error) {
    // Unique (company_id, name) violation → friendly 409.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A template with that name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ template: created as InboxTemplate })
}
