import { NextResponse } from 'next/server'
import { resolveQuoteCaller } from '@/lib/quote-access'
import { companyJobberUserId } from '@/lib/jobber'
import { readJobberCatalog } from '@/lib/jobber-catalog'

// GET /api/hub/quotes/catalog — the Jobber Products & Services list, read live,
// for the quote template editor and (next) the quote builder. Anyone who can
// build quotes.

export async function GET() {
  const c = await resolveQuoteCaller('use')
  if ('error' in c) return c.error
  const jobberUserId = await companyJobberUserId(c.companyId, c.userId)
  if (!jobberUserId) return NextResponse.json({ error: 'Jobber is not connected for your company' }, { status: 400 })
  try {
    return NextResponse.json({ products: await readJobberCatalog(jobberUserId) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read the Jobber catalog' }, { status: 502 })
  }
}
