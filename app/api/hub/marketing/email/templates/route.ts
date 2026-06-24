import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEmailAccess } from '@/lib/email-auth'
import { normalizeDesign, renderDesignToHtml } from '@/lib/email-blocks'

const MAX_NAME = 120
const MAX_SUBJECT = 200

const SELECT = 'id, name, subject, design, body_html, created_by, created_at, updated_at'

// GET /api/hub/marketing/email/templates — all templates for the company.
export async function GET() {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('email_templates')
    .select(SELECT)
    .eq('company_id', access.companyId)
    .order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ templates: data ?? [] })
}

// POST /api/hub/marketing/email/templates — create. body: { name, subject, design }
// body_html is rendered server-side from the block design (the email-safe output
// used at send time); images are absolutized against this request's origin.
export async function POST(request: Request) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await request.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  const subject = String(body.subject || '').trim()
  const design = normalizeDesign(body.design)

  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  if (name.length > MAX_NAME) return NextResponse.json({ error: `Name max ${MAX_NAME} chars` }, { status: 400 })
  if (subject.length > MAX_SUBJECT) return NextResponse.json({ error: `Subject max ${MAX_SUBJECT} chars` }, { status: 400 })

  // Public domain (not the proxy-internal request origin) so image URLs resolve in inboxes.
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('email_templates')
    .insert({
      company_id: access.companyId,
      name, subject,
      design,
      body_html: renderDesignToHtml(design, { baseUrl }),
      created_by: access.userId,
    })
    .select(SELECT)
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message || 'Insert failed' }, { status: 500 })
  return NextResponse.json({ template: data })
}
