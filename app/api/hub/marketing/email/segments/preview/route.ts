import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEmailAccess } from '@/lib/email-auth'
import { normalizeFilter, previewSegment } from '@/lib/email-segments'

// POST /api/hub/marketing/email/segments/preview — live "≈ N recipients" for the
// segment builder. body: { filter }. Returns count + a small sample (names/emails).
export async function POST(request: Request) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await request.json().catch(() => ({}))
  const filter = normalizeFilter(body.filter)

  const admin = createAdminClient()
  const { count, sample } = await previewSegment(admin, access.companyId, filter)
  return NextResponse.json({ count, sample })
}
