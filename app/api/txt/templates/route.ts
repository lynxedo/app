import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

const MAX_TITLE = 80
const MAX_BODY = 1500

// GET /api/txt/templates
// Returns all templates visible to the caller: own personal + same-company org.
// Personal first (so picker shows the user's own canned messages on top), then org.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Two RLS-gated reads (org and personal) — supabase-js cannot OR across two
  // distinct policy paths in a single .select with this RLS shape, so we do two
  // and merge. Both are small (<100 rows expected per company).
  const [orgRes, personalRes] = await Promise.all([
    supabase
      .from('txt_templates')
      .select('id, scope, title, body, media, sort_order, owner_user_id, updated_at')
      .eq('scope', 'org')
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true }),
    supabase
      .from('txt_templates')
      .select('id, scope, title, body, media, sort_order, owner_user_id, updated_at')
      .eq('scope', 'personal')
      .eq('owner_user_id', user.id)
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true }),
  ])

  if (orgRes.error || personalRes.error) {
    return NextResponse.json(
      { error: orgRes.error?.message || personalRes.error?.message || 'Load failed' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    templates: [...(personalRes.data || []), ...(orgRes.data || [])],
  })
}

// POST /api/txt/templates
// Creates a personal template owned by the caller.
// Body: { title, body, sort_order? }
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const title = String(body.title || '').trim()
  const text = String(body.body || '').trim()
  const sortOrder = Number.isFinite(body.sort_order) ? Number(body.sort_order) : 0
  // media = R2 storage paths from /api/txt/upload. Single image enforced here
  // (stored as an array for future multi-attachment support).
  const media = Array.isArray(body.media)
    ? body.media.filter((m: unknown) => typeof m === 'string').slice(0, 1)
    : []

  if (!title) return NextResponse.json({ error: 'Title required' }, { status: 400 })
  // A template needs body text OR an attachment (an image-only template is valid).
  if (!text && media.length === 0)
    return NextResponse.json({ error: 'Add a message or an attachment' }, { status: 400 })
  if (title.length > MAX_TITLE)
    return NextResponse.json({ error: `Title max ${MAX_TITLE} chars` }, { status: 400 })
  if (text.length > MAX_BODY)
    return NextResponse.json({ error: `Body max ${MAX_BODY} chars` }, { status: 400 })

  const admin = createAdminClient()
  const { data: inserted, error } = await admin
    .from('txt_templates')
    .insert({
      company_id: HEROES_COMPANY_ID,
      scope: 'personal',
      owner_user_id: user.id,
      title,
      body: text,
      media,
      sort_order: sortOrder,
    })
    .select('id, scope, title, body, media, sort_order, owner_user_id, updated_at')
    .single()

  if (error || !inserted) {
    return NextResponse.json({ error: error?.message || 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json({ template: inserted })
}
