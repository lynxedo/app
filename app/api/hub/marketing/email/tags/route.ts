import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEmailAccess } from '@/lib/email-auth'

// GET /api/hub/marketing/email/tags — the company's unified tag vocabulary, for
// the segment builder's tag pickers. These are the same contact_tags every tool
// shares; the list "lights up" automatically as Jobber/Mailchimp/manual tags land.
export async function GET() {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('contact_tags')
    .select('id, label, color')
    .eq('company_id', access.companyId)
    .order('label', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tags: data ?? [] })
}
