import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEmailAccess } from '@/lib/email-auth'
import { normalizeFilter } from '@/lib/email-segments'

const MAX_NAME = 120
const SELECT = 'id, name, filter, created_by, created_at, updated_at'

// GET /api/hub/marketing/email/segments — saved segments for the company.
export async function GET() {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('email_segments')
    .select(SELECT)
    .eq('company_id', access.companyId)
    .order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ segments: data ?? [] })
}

// POST /api/hub/marketing/email/segments — create. body: { name, filter }
export async function POST(request: Request) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await request.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  if (name.length > MAX_NAME) return NextResponse.json({ error: `Name max ${MAX_NAME} chars` }, { status: 400 })
  const filter = normalizeFilter(body.filter)

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('email_segments')
    .insert({ company_id: access.companyId, name, filter, created_by: access.userId })
    .select(SELECT)
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message || 'Insert failed' }, { status: 500 })
  return NextResponse.json({ segment: data })
}
