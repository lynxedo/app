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

const PRODUCT_IDS_QUERY = `
  query AmberProductIds { productOrServices(first: 200) { nodes { id name } } }
`

// Root visits query, same shape the nightly sync uses. Filtered server-side to
// UPCOMING + a startAt window + (when resolvable) the specific product/service,
// so we count only this service's future bookings.
const VISITS_QUERY = `
  query AmberAvailability($filter: VisitFilterAttributes) {
    visits(first: 100, filter: $filter) {
      nodes { id startAt }
    }
  }
`

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
    const p = await jobberGraphQLAdmin<{
      data: { productOrServices: { nodes: { id: string; name: string }[] } }
    }>(opts.jobberUserId, PRODUCT_IDS_QUERY, {})
    const nm = opts.serviceLineItem.toLowerCase()
    productId =
      p.data?.productOrServices?.nodes?.find((n) => n.name.toLowerCase() === nm)?.id ?? null
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
    const resp = await jobberGraphQLAdmin<{
      data: { visits: { nodes: { id: string; startAt: string | null }[] } }
    }>(opts.jobberUserId, VISITS_QUERY, { filter })
    for (const v of resp.data?.visits?.nodes ?? []) {
      if (!v.startAt) continue
      const ymd = centralYmd(new Date(v.startAt))
      countByDay[ymd] = (countByDay[ymd] ?? 0) + 1
    }
  } catch (err) {
    console.error('[voice.capacity] visits query failed', err)
    // Fall through with empty counts — request mode's human step catches conflicts.
  }

  return countByDay
}
