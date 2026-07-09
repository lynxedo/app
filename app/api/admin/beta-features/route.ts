import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireBetaAdmin } from '@/lib/beta-auth'
import { BETA_FEATURE_SELECT } from '@/lib/beta-flags'

// Admin → Beta registry CRUD (super-admin only). Writes use the service-role
// admin client (beta_features has no RLS write policy by design).

const KEY_RE = /^[a-z][a-z0-9_]*$/

// GET — every beta feature this admin manages (platform-wide + own company).
export async function GET() {
  const gate = await requireBetaAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('beta_features')
    .select(BETA_FEATURE_SELECT)
    .or(`company_id.is.null,company_id.eq.${gate.companyId}`)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ features: data ?? [] })
}

// POST — create a new beta feature row.
export async function POST(request: Request) {
  const gate = await requireBetaAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const raw = (await request.json().catch(() => null)) as {
    key?: string
    label?: string
    description?: string
    is_available?: boolean
    default_on?: boolean
    sort_order?: number
    screenshot_url?: string | null
  } | null
  if (!raw) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const key = (raw.key ?? '').trim().toLowerCase()
  const label = (raw.label ?? '').trim()
  if (!KEY_RE.test(key))
    return NextResponse.json({ error: 'Key must be a lowercase slug (letters, digits, underscore; start with a letter).' }, { status: 400 })
  if (!label) return NextResponse.json({ error: 'A label is required.' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('beta_features')
    .insert({
      key,
      label,
      description: (raw.description ?? '').trim(),
      is_available: raw.is_available ?? true,
      default_on: raw.default_on ?? false,
      sort_order: typeof raw.sort_order === 'number' ? raw.sort_order : 0,
      screenshot_url: raw.screenshot_url ?? null,
      company_id: null, // platform-wide for the single-tenant present (PRD §9)
    })
    .select(BETA_FEATURE_SELECT)
    .single()
  if (error) {
    const msg = error.code === '23505' ? 'A beta feature with that key already exists.' : error.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  return NextResponse.json({ feature: data }, { status: 201 })
}
