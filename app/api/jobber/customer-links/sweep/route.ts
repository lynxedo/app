import { NextResponse } from 'next/server'
import { companiesWithLinkField, sweepCustomerLinks } from '@/lib/jobber-customer-link'

// Writes the Jobber "Lynxedo Customer File" link onto clients that don't have it.
// Called by the VPS cron, daily:
//   curl -s -X POST https://lynxedo.com/api/jobber/customer-links/sweep -H "x-cron-secret: $CRON_SECRET"
//
// One call = one bounded slice per company. It is resumable (see the
// txt_contacts.jobber_link_set_at marker), so the backlog drains over however many
// runs it takes and steady state is a handful of new customers a day.
//
// Inert until a company has customer_link_field_id in its Jobber integration
// config, so this ships as a no-op for every tenant that hasn't been set up.

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  // Both optional — handy for a cautious first run ("?limit=1") without editing cron.
  const limitParam = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 1000) : 250
  const only = url.searchParams.get('companyId')

  const companies = only ? [only] : await companiesWithLinkField()
  const results = []
  for (const companyId of companies) {
    results.push(await sweepCustomerLinks(companyId, { limit }))
  }

  return NextResponse.json({ ok: true, companies: companies.length, results })
}
