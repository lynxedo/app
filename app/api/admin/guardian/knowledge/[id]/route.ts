import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import {
  getKnowledgeDocById,
  saveVersion,
  getVersionsForDoc,
  isRouterSlug,
  parseAudiences,
  type KnowledgeDoc,
} from '@/lib/guardian-knowledge'

export const dynamic = 'force-dynamic'

const SLUG_RE = /^[a-z0-9_-]+$/
const SLUG_MAX = 60
const TITLE_MAX = 120

async function requireGuardianAdmin() {
  const check = await requireAdminArea('ai')
  if (!check.ok || !check.company_id || !check.user) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id, userId: check.user.id }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireGuardianAdmin()
  if ('error' in ctx) return ctx.error
  const { id } = await params

  const admin = createAdminClient()
  try {
    const doc = await getKnowledgeDocById(admin, ctx.companyId, id)
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const versions = await getVersionsForDoc(admin, doc.id, 10)
    return NextResponse.json({ doc, versions, is_router: isRouterSlug(doc.slug) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load doc' }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireGuardianAdmin()
  if ('error' in ctx) return ctx.error
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const admin = createAdminClient()
  const existing = await getKnowledgeDocById(admin, ctx.companyId, id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: ctx.userId }
  let bodyChanged = false
  let titleChanged = false

  if ('slug' in body) {
    const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
    if (!slug || !SLUG_RE.test(slug) || slug.length > SLUG_MAX) {
      return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
    }
    if (isRouterSlug(existing.slug) && slug !== 'router') {
      return NextResponse.json({ error: 'The router doc cannot be renamed' }, { status: 400 })
    }
    if (slug !== existing.slug) patch.slug = slug
  }

  if ('title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    if (title.length > TITLE_MAX) {
      return NextResponse.json({ error: `Title must be ${TITLE_MAX} characters or fewer` }, { status: 400 })
    }
    if (title !== existing.title) {
      patch.title = title
      titleChanged = true
    }
  }

  if ('body' in body) {
    const docBody = typeof body.body === 'string' ? body.body : ''
    if (docBody !== existing.body) {
      patch.body = docBody
      bodyChanged = true
    }
  }

  // "Used by" audiences are the source of truth; keep always_include synced.
  if ('audiences' in body) {
    const audiences = parseAudiences(body.audiences)
    patch.audiences = audiences
    patch.always_include = audiences.length > 0
  } else if ('always_include' in body) {
    const ai = body.always_include === true
    if (ai !== existing.always_include) patch.always_include = ai
  }

  const { data, error } = await admin
    .from('guardian_knowledge_docs')
    .update(patch)
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .select('*')
    .single()

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Another doc already uses that slug' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const doc = data as KnowledgeDoc

  if (bodyChanged || titleChanged) {
    try {
      await saveVersion(admin, doc.id, ctx.companyId, doc.body, doc.title, ctx.userId)
    } catch (e) {
      console.error('[guardian-knowledge] saveVersion failed:', e)
    }
  }

  return NextResponse.json({ doc, is_router: isRouterSlug(doc.slug) })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireGuardianAdmin()
  if ('error' in ctx) return ctx.error
  const { id } = await params

  const admin = createAdminClient()
  const existing = await getKnowledgeDocById(admin, ctx.companyId, id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (isRouterSlug(existing.slug)) {
    return NextResponse.json({ error: 'The router doc cannot be deleted' }, { status: 400 })
  }

  const { error } = await admin
    .from('guardian_knowledge_docs')
    .delete()
    .eq('id', id)
    .eq('company_id', ctx.companyId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
