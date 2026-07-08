import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEmailAccess } from '@/lib/email-auth'
import { listSendingIdentities } from '@/lib/email-identities'

// GET /api/hub/marketing/email/identities — the company's sending identities, for
// the "Send from" picker on the campaign composer + automation editor. Only
// VERIFIED identities are offered (an unverified domain can't deliver). Anyone
// with can_access_email may read them; managing them is admin-only (Admin → Email).
export async function GET() {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const admin = createAdminClient()
  const all = await listSendingIdentities(admin, access.companyId)
  const identities = all
    .filter((i) => i.domain_verified)
    .map((i) => ({ id: i.id, label: i.label, from_name: i.from_name, from_email: i.from_email, is_default: i.is_default }))

  return NextResponse.json({ identities })
}
