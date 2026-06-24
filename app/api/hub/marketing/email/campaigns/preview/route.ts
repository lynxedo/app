import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEmailAccess } from '@/lib/email-auth'
import { normalizeAudienceSpec, resolveCampaignAudience } from '@/lib/email-campaigns'

// POST /api/hub/marketing/email/campaigns/preview
//   body { everyone?, segment_ids?[], contact_ids?[], extra_emails?[], excluded_ids?[], full? }
//
// Resolves the COMBINED, de-duplicated audience for the campaign composer's live
// "≈ N recipients" count. With full=true it also returns the candidate directory
// contacts (excluded_ids ignored) so the "Review recipients" modal can toggle
// each one — typed-in addresses are managed in their own box, not here.
export async function POST(request: Request) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const full = body.full === true
  const admin = createAdminClient()

  if (full) {
    // The full candidate set (exclusions applied client-side in the modal). Only
    // directory contacts are reviewable; typed addresses always send.
    const spec = normalizeAudienceSpec({ ...body, excluded_ids: [], extra_emails: [] })
    const rows = await resolveCampaignAudience(admin, access.companyId, spec)
    const contacts = rows
      .filter((r) => r.contact_id)
      .map((r) => ({
        id: r.contact_id as string,
        name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || r.email,
        email: r.email,
      }))
    return NextResponse.json({ count: contacts.length, contacts })
  }

  const spec = normalizeAudienceSpec(body)
  const rows = await resolveCampaignAudience(admin, access.companyId, spec)
  return NextResponse.json({ count: rows.length })
}
