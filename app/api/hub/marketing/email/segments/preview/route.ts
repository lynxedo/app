import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEmailAccess } from '@/lib/email-auth'
import { normalizeFilter, previewSegment, resolveSegment } from '@/lib/email-segments'

// POST /api/hub/marketing/email/segments/preview — live "≈ N recipients" for the
// segment builder. body: { filter, full? }.
//   default       -> { count, sample } (small sample for the live count)
//   { full:true } -> { count, contacts: [{id,name,email}] } (the full list, for
//                     the "View contacts" modal)
export async function POST(request: Request) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await request.json().catch(() => ({}))
  const filter = normalizeFilter(body.filter)
  const admin = createAdminClient()

  if (body.full) {
    const rows = await resolveSegment(admin, access.companyId, filter)
    const contacts = rows.map((r) => ({
      id: r.id,
      name: (r.name || `${r.first_name ?? ''} ${r.last_name ?? ''}`).trim() || r.email,
      email: r.email,
    }))
    return NextResponse.json({ count: contacts.length, contacts })
  }

  const { count, sample } = await previewSegment(admin, access.companyId, filter)
  return NextResponse.json({ count, sample })
}
