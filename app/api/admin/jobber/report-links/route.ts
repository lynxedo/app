import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { companyJobberUserId, jobberGraphQLAdmin } from '@/lib/jobber'

export const dynamic = 'force-dynamic'

// Which Jobber line items put a report link on a job.
//
// Configured rather than inferred: deciding from the job title or a code prefix
// would encode one company's shorthand ("IR", "WF") as product behaviour. Each
// report owns its own Jobber link custom field, so a job carrying both irrigation
// and weed-feed work shows both links.

const PRODUCTS = `
  query { productOrServices(first: 200) { nodes { id name } } }
`

export async function GET() {
  const check = await requireAdminArea('integrations')
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createAdminClient()

  const { data: reports } = await admin
    .from('jobber_report_links')
    .select('report_key, label, link_text, url_suffix, line_items, enabled')
    .eq('company_id', check.company_id)
    .order('label')

  // The pickable catalog comes from Jobber itself, so the names always match what
  // a job actually carries. A dead connection just means an empty picker, not a 500.
  let catalog: { id: string; name: string }[] = []
  try {
    const userId = await companyJobberUserId(check.company_id, check.user?.id ?? '')
    if (userId) {
      const res = await jobberGraphQLAdmin<{ productOrServices?: { nodes?: { id: string; name: string }[] } }>(userId, PRODUCTS)
      catalog = (res?.productOrServices?.nodes ?? []).filter((n) => n?.name)
    }
  } catch (e) {
    console.error('[report-links] catalog fetch failed:', e instanceof Error ? e.message : e)
  }

  return NextResponse.json({ reports: reports ?? [], catalog })
}

export async function PUT(request: Request) {
  const check = await requireAdminArea('integrations')
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as
    | { report_key?: string; line_items?: unknown; enabled?: unknown }
    | null
  if (!body?.report_key) return NextResponse.json({ error: 'report_key required' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (Array.isArray(body.line_items)) {
    // Names only, trimmed and de-duplicated. Matching is case-insensitive downstream.
    patch.line_items = [...new Set(
      body.line_items.filter((n): n is string => typeof n === 'string').map((n) => n.trim()).filter(Boolean),
    )]
  }
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled

  const admin = createAdminClient()
  const { error } = await admin
    .from('jobber_report_links')
    .update(patch)
    .eq('company_id', check.company_id)
    .eq('report_key', body.report_key)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
