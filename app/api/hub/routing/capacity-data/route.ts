import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateRoutingUser, loadCapacityData } from '@/lib/route-capacity-server'

export const dynamic = 'force-dynamic'

// GET → { tanks, serviceProducts, products } — everything Advanced Routing needs
// to compute the tank loadout (Part C) client-side. Read once when the Advanced
// view mounts; the calc itself is pure (lib/route-capacity.ts).
export async function GET() {
  const ctx = await gateRoutingUser()
  if ('error' in ctx) return ctx.error

  const admin = createAdminClient()
  const { tanks, serviceProducts, products, error } = await loadCapacityData(admin, ctx.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tanks, serviceProducts, products })
}
