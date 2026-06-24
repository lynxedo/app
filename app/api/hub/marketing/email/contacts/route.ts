import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEmailAccess } from '@/lib/email-auth'
import { getEmailAudience } from '@/lib/email-contacts'

// GET /api/hub/marketing/email/contacts — the emailable audience (has an email,
// subscribed, not suppressed) for the campaign "pick specific contacts" picker.
// Same source of truth as a campaign send, so the picker can never offer someone
// who'd be skipped at send time.
export async function GET() {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const admin = createAdminClient()
  const rows = await getEmailAudience(admin, access.companyId)
  const contacts = rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: (r.name || `${r.first_name ?? ''} ${r.last_name ?? ''}`).trim() || r.email,
  }))
  return NextResponse.json({ contacts })
}
