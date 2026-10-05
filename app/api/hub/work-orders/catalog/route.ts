import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { workOrderAccess } from '@/lib/work-order-access'
import { jobberGraphQLPatient, companyJobberUserId } from '@/lib/jobber'

// GET  /api/hub/work-orders/catalog — the Jobber Products & Services list for
//      the stop's "+ Add line item" picker, read LIVE (PRD rule 5: no cached
//      prices), plus the caller's own favorites and recent picks.
// POST /api/hub/work-orders/catalog { productId, name?, favorite: boolean }
//      — star / unstar an item for the caller.
// Work Orders Phase 2.

type Product = {
  id: string
  name: string
  description: string | null
  defaultUnitCost: number | null
  taxable: boolean | null
  category: string | null
  visible: boolean | null
}

const CATALOG_QUERY = `
  query WorkOrderCatalog($after: String) {
    productOrServices(first: 100, after: $after) {
      nodes { id name description defaultUnitCost taxable category visible }
      pageInfo { hasNextPage endCursor }
    }
  }
`

async function gate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase
    .from('user_profiles').select('company_id, role, can_admin_daily_log, can_access_daily_log_v2')
    .eq('id', user.id).single()
  if (!profile?.company_id) return { error: NextResponse.json({ error: 'No company' }, { status: 403 }) }
  if (!workOrderAccess(profile).canAccess) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { userId: user.id, companyId: profile.company_id as string }
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  const jobberUserId = await companyJobberUserId(g.companyId, g.userId)
  if (!jobberUserId) return NextResponse.json({ error: 'Jobber is not connected for your company' }, { status: 400 })

  const products: Product[] = []
  try {
    let after: string | null = null
    for (let page = 0; page < 10; page++) {
      const res: { data?: { productOrServices: { nodes: Product[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } } =
        await jobberGraphQLPatient(jobberUserId, CATALOG_QUERY, { after })
      const conn = res.data?.productOrServices
      if (!conn) break
      products.push(...conn.nodes)
      if (!conn.pageInfo.hasNextPage) break
      after = conn.pageInfo.endCursor
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read the Jobber catalog' }, { status: 502 })
  }

  const admin = createAdminClient()
  const { data: usage } = await admin
    .from('work_order_catalog_usage')
    .select('jobber_product_id, use_count, last_used_at, is_favorite')
    .eq('user_id', g.userId)

  return NextResponse.json({
    products: products
      .filter(p => p.visible !== false)
      .map(p => ({ id: p.id, name: p.name, description: p.description, price: p.defaultUnitCost ?? 0, taxable: p.taxable, category: p.category }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    usage: (usage ?? []).map(u => ({
      productId: u.jobber_product_id as string,
      useCount: u.use_count as number,
      lastUsedAt: u.last_used_at as string | null,
      favorite: u.is_favorite as boolean,
    })),
  })
}

export async function POST(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  let body: { productId?: unknown; name?: unknown; favorite?: unknown } = {}
  try { body = await req.json() } catch { /* empty */ }
  if (typeof body.productId !== 'string' || !body.productId || typeof body.favorite !== 'boolean') {
    return NextResponse.json({ error: 'productId and favorite are required' }, { status: 400 })
  }
  const admin = createAdminClient()
  const nowIso = new Date().toISOString()
  const { error } = await admin.from('work_order_catalog_usage').upsert({
    company_id: g.companyId,
    user_id: g.userId,
    jobber_product_id: body.productId,
    product_name: typeof body.name === 'string' ? body.name : null,
    is_favorite: body.favorite,
    updated_at: nowIso,
  }, { onConflict: 'user_id,jobber_product_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
