import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateServiceMapping, loadServiceMappingData } from '@/lib/service-mapping-server'

export const dynamic = 'force-dynamic'

// GET — the whole Service Mapping screen: line-item→product map, program rounds,
// the live product catalog, and the distinct Jobber line-item names.
export async function GET() {
  const ctx = await gateServiceMapping()
  if ('error' in ctx) return ctx.error
  const admin = createAdminClient()
  const { serviceProducts, rounds, products, lineItemNames, error } = await loadServiceMappingData(admin, ctx.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ serviceProducts, rounds, products, lineItemNames })
}
