import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveQuoteCaller } from '@/lib/quote-access'
import { loadLivePrograms } from '@/lib/pricer-charts'

// GET /api/hub/quotes/pricer — the live program price charts for the quote
// builder's "Insert from Pricer". Anyone who can build quotes (a tech quoting a
// lawn program needs the price even without the Pricer grant). Same read rule
// as the Pricer itself (lib/pricer-charts.ts).

export async function GET() {
  const c = await resolveQuoteCaller('use')
  if ('error' in c) return c.error
  try {
    return NextResponse.json({ programs: await loadLivePrograms(createAdminClient(), c.companyId) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load price charts' }, { status: 500 })
  }
}
