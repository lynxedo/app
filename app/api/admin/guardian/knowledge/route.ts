import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import {
  getKnowledgeDocs,
  saveVersion,
  isRouterSlug,
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

export async function GET() {
  const ctx = await requireGuardianAdmin()
  if ('error' in ctx) return ctx.error
  const admin = createAdminClient()
  try {
    const docs = await getKnowledgeDocs(admin, ctx.companyId)
    return NextResponse.json({ docs })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load docs' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const ctx = await requireGuardianAdmin()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const docBody = typeof body.body === 'string' ? body.body : ''
  const alwaysInclude = body.always_include === true

  if (!slug) return NextResponse.json({ error: 'Slug is required' }, { status: 400 })
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json(
      { error: 'Slug must be lowercase letters, numbers, hyphens, or underscores only' },
      { status: 400 }
    )
  }
  if (slug.length > SLUG_MAX) {
    return NextResponse.json({ error: `Slug must be ${SLUG_MAX} characters or fewer` }, { status: 400 })
  }
  if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  if (title.length > TITLE_MAX) {
    return NextResponse.json({ error: `Title must be ${TITLE_MAX} characters or fewer` }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('guardian_knowledge_docs')
    .insert({
      company_id: ctx.companyId,
      slug,
      title,
      body: docBody,
      always_include: alwaysInclude,
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error) {
    // 23505 = unique_violation (company_id + slug)
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: `A doc with slug "${slug}" already exists` }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const doc = data as KnowledgeDoc
  try {
    await saveVersion(admin, doc.id, ctx.companyId, doc.body, doc.title, ctx.userId)
  } catch (e) {
    // Version insert failure is non-fatal — log and continue.
    console.error('[guardian-knowledge] saveVersion failed:', e)
  }

  return NextResponse.json({ doc, is_router: isRouterSlug(doc.slug) })
}
