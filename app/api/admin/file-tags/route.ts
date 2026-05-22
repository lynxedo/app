import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

const VALID_TAG_TYPES = ['general', 'social-page', 'social-queue'] as const
type TagType = (typeof VALID_TAG_TYPES)[number]

async function requireAdmin() {
  const check = await requireAdminArea('hub')
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
    .from('hub_file_tags')
    .select('id, name, color, tag_type, description, created_at')
    .eq('company_id', ctx.companyId)
    .order('tag_type', { ascending: true })
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tags: data ?? [] })
}

export async function POST(request: Request) {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error

  const body = await request.json().catch(() => ({}))
  const name: string = (body.name ?? '').trim()
  const color: string = (body.color ?? '#6B7280').trim()
  const tagType: string = (body.tag_type ?? 'general').trim()
  const description: string | null = body.description?.trim() || null

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!VALID_TAG_TYPES.includes(tagType as TagType)) {
    return NextResponse.json({ error: `tag_type must be one of ${VALID_TAG_TYPES.join(', ')}` }, { status: 400 })
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return NextResponse.json({ error: 'color must be a 6-digit hex like #F97316' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('hub_file_tags')
    .insert({
      company_id: ctx.companyId,
      name,
      color,
      tag_type: tagType,
      description,
    })
    .select('id, name, color, tag_type, description, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A tag with that name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ tag: data }, { status: 201 })
}
