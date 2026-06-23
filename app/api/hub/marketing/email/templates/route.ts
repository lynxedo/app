import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEmailAccess } from '@/lib/email-auth'
import { markdownToHtml } from '@/lib/email-markdown'

const MAX_NAME = 120
const MAX_SUBJECT = 200
const MAX_BODY = 50000

const SELECT = 'id, name, subject, body_markdown, body_html, created_by, created_at, updated_at'

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

// POST /api/hub/marketing/email/templates — create. body: { name, subject, body_markdown }
export async function POST(request: Request) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await request.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  const subject = String(body.subject || '').trim()
  const markdown = String(body.body_markdown || '')

  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  if (name.length > MAX_NAME) return NextResponse.json({ error: `Name max ${MAX_NAME} chars` }, { status: 400 })
  if (subject.length > MAX_SUBJECT) return NextResponse.json({ error: `Subject max ${MAX_SUBJECT} chars` }, { status: 400 })
  if (markdown.length > MAX_BODY) return NextResponse.json({ error: `Body too long` }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('email_templates')
    .insert({
      company_id: access.companyId,
      name, subject,
      body_markdown: markdown,
      body_html: markdownToHtml(markdown),
      created_by: access.userId,
    })
    .select(SELECT)
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message || 'Insert failed' }, { status: 500 })
  return NextResponse.json({ template: data })
}
