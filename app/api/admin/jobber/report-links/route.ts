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

// Jobber caps a page at 100 no matter what `first` asks for — requesting 200
// silently returns 100. Heroes has 162 products and 62 of the irrigation ones sat
// on page two, invisible in the picker, which made this tool useless for the exact
// job it exists to do. Page until Jobber says there is no more.
const PRODUCTS = `
  query Products($after: String) {
    productOrServices(first: 100, after: $after) {
      nodes { id name }
      pageInfo { hasNextPage endCursor }
    }
  }
`
const MAX_PAGES = 20

type ProductsPage = {
  productOrServices?: {
    nodes?: { id: string; name: string }[]
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
  }
}

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
  let source: 'jobber' | 'history' | 'none' = 'jobber'
  try {
    const userId = await companyJobberUserId(check.company_id, check.user?.id ?? '')
    if (userId) {
      let after: string | null = null
      for (let page = 0; page < MAX_PAGES; page++) {
        // Jobber's bucket is shared with the sync, which can be mid-run and
        // pacing itself. A single refused request used to empty the whole picker
        // and show "check your connection" — alarming, and wrong.
        let res: ProductsPage | null = null
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            res = await jobberGraphQLAdmin<ProductsPage>(userId, PRODUCTS, { after })
            break
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            if (!/throttl/i.test(msg) || attempt === 2) throw err
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
          }
        }
        if (!res) break
        const conn: ProductsPage['productOrServices'] = res.productOrServices
        catalog.push(...(conn?.nodes ?? []).filter((n: { id: string; name: string }) => !!n?.name))
        if (!conn?.pageInfo?.hasNextPage) break
        after = conn.pageInfo.endCursor ?? null
        if (!after) break
      }
      catalog.sort((a, b) => a.name.localeCompare(b.name))
    }
  } catch (e) {
    console.error('[report-links] catalog fetch failed:', e instanceof Error ? e.message : e)
  }

  // Jobber unavailable — fall back to the line-item names already on this
  // company's jobs. Narrower than the full catalog (only what's been used), but
  // it is exactly the set that can actually match a job, so the picker stays
  // usable instead of going blank whenever a sync is mid-run.
  if (!catalog.length) {
    const { data: seen } = await admin
      .from('line_items')
      .select('name')
      .eq('company_id', check.company_id)
      .eq('parent_type', 'job')
      .is('deleted_at', null)
      .not('name', 'is', null)
      .limit(5000)
    const names = [...new Set((seen ?? []).map((r) => String(r.name).trim()).filter(Boolean))].sort()
    catalog = names.map((n) => ({ id: `history:${n}`, name: n }))
    source = catalog.length ? 'history' : 'none'
  }

  return NextResponse.json({ reports: reports ?? [], catalog, source })
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
