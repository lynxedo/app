import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEmailAccess } from '@/lib/email-auth'
import { markdownToHtml } from '@/lib/email-markdown'

const MAX_NAME = 120
const MAX_SUBJECT = 200
const MAX_BODY = 50000

const SELECT = 'id, name, subject, body_markdown, body_html, created_by, created_at, updated_at'

// PATCH /api/hub/marketing/email/templates/[id] — update name/subject/body.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const { id } = await params

  const body = await request.json().catch(() => ({}))
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.name !== undefined) {
    const name = String(body.name || '').trim()
    if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })
    if (name.length > MAX_NAME) return NextResponse.json({ error: `Name max ${MAX_NAME} chars` }, { status: 400 })
    patch.name = name
  }
  if (body.subject !== undefined) {
    const subject = String(body.subject || '').trim()
    if (subject.length > MAX_SUBJECT) return NextResponse.json({ error: `Subject max ${MAX_SUBJECT} chars` }, { status: 400 })
    patch.subject = subject
  }
  if (body.body_markdown !== undefined) {
    const markdown = String(body.body_markdown || '')
    if (markdown.length > MAX_BODY) return NextResponse.json({ error: 'Body too long' }, { status: 400 })
    patch.body_markdown = markdown
    patch.body_html = markdownToHtml(markdown)
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('email_templates')
    .update(patch)
    .eq('id', id)
    .eq('company_id', access.companyId)
    .select(SELECT)
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message || 'Not found' }, { status: 404 })
  return NextResponse.json({ template: data })
}

// DELETE /api/hub/marketing/email/templates/[id]
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const { id } = await params

  const admin = createAdminClient()
  const { error } = await admin
    .from('email_templates')
    .delete()
    .eq('id', id)
    .eq('company_id', access.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
