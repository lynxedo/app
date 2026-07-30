import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePlatformAdmin } from '@/lib/platform-auth'
import { computeInvoiceLines } from '@/lib/billing/invoice'

// Platform super-admin: the itemized usage/fee lines for one tenant over a period, for
// building a manual invoice. Read-only (no Stripe needed) — reads the catalog prices +
// the usage counters. Query: ?company=<id>&from=<iso>&to=<iso>.
export async function GET(request: Request) {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const url = new URL(request.url)
  const companyId = (url.searchParams.get('company') || '').trim()
  const from = (url.searchParams.get('from') || '').trim()
  const to = (url.searchParams.get('to') || '').trim()
  if (!companyId || !from || !to) {
    return NextResponse.json({ error: 'company, from and to are required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  try {
    const lines = await computeInvoiceLines(admin, companyId, from, to)
    return NextResponse.json({ lines })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
