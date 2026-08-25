// AI Voice Receptionist — how many jobs are already on the calendar for a given day.
//
// Extracted from app/api/voice/availability so the BOOKING route can apply the same
// count. It previously lived only in the availability path, which meant a per-day cap
// was enforced only when Amber consulted availability first — and nothing forces her
// to. A caller saying "can you come Monday?" leads straight to book_appointment with
// that date, past the only check. For Ben's *"up to 4 irrigation service calls for
// Monday the 31st"* that gap is the difference between a real limit and a suggestion.
//
// Read-only against Jobber. Every failure returns an empty count rather than throwing:
// a Jobber hiccup must not take booking off the air, and the downstream callers treat
// "no counts" as "no known conflicts" exactly as they did before.

import { jobberGraphQLAdmin } from '@/lib/jobber'
import { addDaysYmd, centralYmd } from '@/lib/voice-scheduling'

// ⚠ Jobber caps a connection page at 100 REGARDLESS of what `first:` asks for, and
// says nothing about it — this query used to ask for 200 and silently receive 100 of
// Heroes' 162 products, leaving 62 unmatchable. Both queries below page properly.
const PRODUCT_IDS_QUERY = `
  query AmberProductIds($after: String) {
    productOrServices(first: 100, after: $after) {
      nodes { id name }
      pageInfo { hasNextPage endCursor }
    }
  }
`

// Root visits query, same shape the nightly sync uses. Filtered server-side to
// UPCOMING + a startAt window + (when resolvable) the specific product/service,
// so we count only this service's future bookings.
const VISITS_QUERY = `
  query AmberAvailability($filter: VisitFilterAttributes, $after: String) {
    visits(first: 100, filter: $filter, after: $after) {
      nodes { id startAt }
      pageInfo { hasNextPage endCursor }
    }
  }
`

/**
 * Compare a service name the way a human would read it, not the way it was typed.
 *
 * The Jobber catalog is hand-entered and its names carry the evidence: Heroes' two
 * schedulable services are stored there as `"IR - Irrigation Service Call - T1 "` and
 * `"WF - Free Lawn Assessment "` — both with a TRAILING SPACE — and a third product
 * reads `"IR - Irrigation Service Call  After Hours"` with a double space. The config
 * side has no trailing space, so an `===` comparison matched neither, `productId` fell
 * to null, and the count silently went UNSCOPED: every mow, every fert visit, every
 * job of any kind counted against a 4-slot irrigation cap. Every real day read as full
 * and Amber offered whatever day sat past the visit-page cutoff — an artifact, not an
 * opening.
 *
 * One invisible character is a stupid thing to lose a booking to, so normalize both
 * sides: trim, collapse internal runs of whitespace, casefold.
 */
const normalizeServiceName = (s: string): string =>
  s.trim().replace(/\s+/g, ' ').toLowerCase()

type PageInfo = { hasNextPage: boolean; endCursor: string | null }
type ProductPage = {
  data?: { productOrServices?: { nodes?: { id: string; name: string }[]; pageInfo?: PageInfo } }
}
type VisitPage = {
  data?: { visits?: { nodes?: { id: string; startAt: string | null }[]; pageInfo?: PageInfo } }
}

/**
 * Existing UPCOMING visits per Central calendar day, across [fromYmd, toYmd].
 *
 * One query; the UTC bounds are padded a day each side and the results bucketed by
 * Central date, so a visit at 7pm Central doesn't land on the following UTC day.
 *
 * The product/service scope is best-effort: if the service name can't be matched to a
 * Jobber product id the count is left UNSCOPED rather than abandoned, which errs toward
 * over-counting (offering a later day) instead of over-booking.
 */
export async function countBookedVisitsByDay(opts: {
  jobberUserId: string
  serviceLineItem: string
  fromYmd: string
  toYmd: string
}): Promise<Record<string, number>> {
  const countByDay: Record<string, number> = {}

  let productId: string | null = null
  try {
    const nm = normalizeServiceName(opts.serviceLineItem)
    let after: string | null = null
    // Page the catalog rather than trusting one request to hold it — see the note on
    // PRODUCT_IDS_QUERY. Bounded so a bad cursor can't spin forever.
    for (let page = 0; page < 20 && !productId; page++) {
      const vars: Record<string, unknown> = { after }
      const p: ProductPage = await jobberGraphQLAdmin<ProductPage>(
        opts.jobberUserId,
        PRODUCT_IDS_QUERY,
        vars,
      )
      const conn = p.data?.productOrServices
      productId = conn?.nodes?.find((n) => normalizeServiceName(n.name) === nm)?.id ?? null
      if (productId || !conn?.pageInfo?.hasNextPage) break
      after = conn.pageInfo.endCursor ?? null
      if (!after) break
    }
    if (!productId) {
      // Loud on purpose. A miss here is not cosmetic — it downgrades the cap from
      // "4 of THIS service" to "4 jobs of any kind", which reads as a calendar that
      // is permanently full.
      console.warn(
        `[voice.capacity] no Jobber product matched "${opts.serviceLineItem}" — counting UNSCOPED (every service counts against this cap)`,
      )
    }
  } catch {
    // leave productId null → count falls back to unscoped
  }

  try {
    const filter: Record<string, unknown> = {
      status: 'UPCOMING',
      startAt: {
        after: `${addDaysYmd(opts.fromYmd, -1)}T00:00:00Z`,
        before: `${addDaysYmd(opts.toYmd, 1)}T23:59:59Z`,
      },
    }
    if (productId) filter.productOrServiceId = productId
    // Page until the window is exhausted. At one page of 100 the horizon was cut off
    // mid-range and every day past the cutoff counted ZERO — so the first "opening"
    // Amber offered was simply where the data stopped. Heroes books ~150 visits in a
    // fortnight against a 30-day horizon, so this was hit every single call.
    let after: string | null = null
    for (let page = 0; page < 40; page++) {
      const vars: Record<string, unknown> = { filter, after }
      const resp: VisitPage = await jobberGraphQLAdmin<VisitPage>(
        opts.jobberUserId,
        VISITS_QUERY,
        vars,
      )
      const conn = resp.data?.visits
      for (const v of conn?.nodes ?? []) {
        if (!v.startAt) continue
        const ymd = centralYmd(new Date(v.startAt))
        countByDay[ymd] = (countByDay[ymd] ?? 0) + 1
      }
      if (!conn?.pageInfo?.hasNextPage) break
      after = conn.pageInfo.endCursor
      if (!after) break
    }
  } catch (err) {
    console.error('[voice.capacity] visits query failed', err)
    // Fall through with empty counts — request mode's human step catches conflicts.
  }

  return countByDay
}
