// AI Voice Receptionist — turning an agreed slot into a real Jobber JOB.
//
// The Request path (app/api/voice/book) creates a to-do for a human. This module is
// what a company means by "she books it": a job on the schedule, with the title the
// office reads the route off, one line item priced from the live catalog, and an
// Anytime visit assigned to the right crew.
//
// Everything company-specific is CONFIG, never code — the title pattern comes from
// voice_scheduling_services.job_title_template, the neighborhood vocabulary from
// voice_receptionist_settings.neighborhoods, and the price and description are read
// live from the Jobber product catalog so they cannot drift from what is in Jobber.

import type { SupabaseClient } from '@supabase/supabase-js'
import { jobberGraphQLAdmin } from '@/lib/jobber'
import { normalizeServiceName } from '@/lib/voice-capacity'

// ── The Jobber product behind a configured line item ───────────────────────────
// Same catalog + same normalization the capacity counter uses, so "the product we
// count against" and "the product we bill" can never be two different things. That
// mattered: Heroes' catalog stores the name with a TRAILING SPACE, which is exactly
// what broke the counting path before it was normalized.
const PRODUCT_QUERY = `
  query AmberProductLookup($after: String) {
    productOrServices(first: 100, after: $after) {
      nodes { id name description defaultUnitCost }
      pageInfo { hasNextPage endCursor }
    }
  }
`

type ProductPage = {
  data?: {
    productOrServices?: {
      nodes?: { id: string; name: string; description: string | null; defaultUnitCost: number | null }[]
      pageInfo?: { hasNextPage: boolean; endCursor: string | null }
    }
  }
}

export type JobberProduct = {
  id: string
  /** The catalog's own spelling, used VERBATIM on the line item. */
  name: string
  description: string
  unitPrice: number
}

/**
 * Look up a configured line item in the Jobber catalog.
 *
 * Returns the catalog's OWN spelling for `name`, not the configured string: the
 * knowledge base's rule is "copy line item names character for character from the
 * catalog... a near-miss creates a second, wrong product and silently breaks
 * reporting". Matching loosely but writing back exactly is how both stay true.
 */
export async function findJobberProduct(
  jobberUserId: string,
  lineItem: string,
): Promise<JobberProduct | null> {
  const want = normalizeServiceName(lineItem)
  let after: string | null = null
  for (let page = 0; page < 20; page++) {
    const vars: Record<string, unknown> = { after }
    const resp: ProductPage = await jobberGraphQLAdmin<ProductPage>(jobberUserId, PRODUCT_QUERY, vars)
    const conn = resp.data?.productOrServices
    const hit = conn?.nodes?.find((n) => normalizeServiceName(n.name) === want)
    if (hit) {
      return {
        id: hit.id,
        name: hit.name,
        description: (hit.description || '').trim(),
        unitPrice: typeof hit.defaultUnitCost === 'number' ? hit.defaultUnitCost : 0,
      }
    }
    if (!conn?.pageInfo?.hasNextPage) break
    after = conn.pageInfo.endCursor ?? null
    if (!after) break
  }
  return null
}

// ── Neighborhood ───────────────────────────────────────────────────────────────

/**
 * The neighborhood for a customer's job title, taken from THEIR OWN existing jobs.
 *
 * ⚠ Deliberately NOT derived from the service address. Heroes' knowledge doc: "Never
 * infer a neighborhood from a zip code, a city name, or memory. These names are
 * polygons on a map, not cities — several of them overlap the same zip codes, and
 * guessing has produced wrong-neighborhood job titles before." A wrong one routes a
 * truck to the wrong area, so the only acceptable source is evidence about this exact
 * customer: a title the office itself wrote for this same client.
 *
 * Longest match wins, so "Woodlands West" beats a bare "Woodlands", and newest jobs
 * are consulted first. Returns null when nothing matches — the caller must then leave
 * the neighborhood OFF and flag the job rather than invent one. ~70% of Heroes'
 * existing customers resolve; the remainder are a human's five-second fix, which is
 * cheaper than a truck in the wrong subdivision.
 */
export async function neighborhoodFromClientHistory(
  admin: SupabaseClient,
  companyId: string,
  jobberClientId: string,
  neighborhoods: string[],
): Promise<string | null> {
  if (!neighborhoods.length || !jobberClientId) return null

  const { data } = await admin
    .from('jobs')
    .select('title, created_at')
    .eq('company_id', companyId)
    .eq('client_external_id', jobberClientId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(40)

  const titles = ((data as { title: string | null }[] | null) ?? [])
    .map((r) => (r.title || '').toLowerCase())
    .filter(Boolean)
  if (!titles.length) return null

  // Longest first so a specific name is never shadowed by a shorter one it contains.
  const ranked = [...neighborhoods].sort((a, b) => b.length - a.length)
  for (const title of titles) {
    // Apostrophes are written inconsistently in real titles ("Jacob's Reserve" vs
    // "JacobsReserve"), so compare with them stripped from both sides.
    const hay = title.replace(/['’]/g, '')
    for (const n of ranked) {
      if (hay.includes(n.toLowerCase().replace(/['’]/g, ''))) return n
    }
  }
  return null
}

// ── Title ──────────────────────────────────────────────────────────────────────

/**
 * Fill a company's job-title pattern.
 *
 * A missing neighborhood collapses cleanly rather than leaving a hole: the separator
 * around the placeholder goes with it, so `IR SVC $[PRICE] [NEIGHBORHOOD]` becomes
 * `IR SVC $125` and not `IR SVC $125 ` or `IR SVC $125 [NEIGHBORHOOD]`.
 *
 * Price renders without trailing zeros — the office writes `$125`, never `$125.00`.
 */
export function buildJobTitle(
  template: string,
  vars: { price: number; neighborhood: string | null; service: string; lastName: string | null },
): string {
  const price = Number.isFinite(vars.price)
    ? String(Math.round(vars.price * 100) / 100).replace(/\.0+$/, '')
    : ''
  const out = template
    .replace(/\[PRICE\]/g, price)
    .replace(/\[NEIGHBORHOOD\]/g, vars.neighborhood ?? '')
    .replace(/\[SERVICE\]/g, vars.service)
    .replace(/\[LASTNAME\]/g, vars.lastName ?? '')
  return out.replace(/\s+/g, ' ').trim()
}

// ── Jobber writes ──────────────────────────────────────────────────────────────
// Both mutation shapes are the ones already proven by the company's own MCP tooling
// (create_job / schedule_visit), including the two non-obvious constraints noted below.

const JOB_CREATE = `
  mutation AmberJobCreate($input: JobCreateAttributes!) {
    jobCreate(input: $input) {
      job { id jobNumber title }
      userErrors { message }
    }
  }
`

const VISIT_CREATE = `
  mutation AmberVisitCreate($jobId: EncodedId!, $input: VisitCreateInput!) {
    visitCreate(jobId: $jobId, input: $input) {
      createdVisits { id }
      userErrors { message }
    }
  }
`

export type CreatedJob = { id: string; jobNumber: string | null; title: string }

/**
 * Create the job. `invoicing` is required by Jobber; flat price billed on completion
 * matches what the company's own tooling has always sent.
 *
 * ⚠ `timeframe` carries startAt ONLY. Adding durationValue/durationUnits makes Jobber
 * treat the job as RECURRING — a one-off service call would silently become a series.
 */
export async function createJobberJob(
  jobberUserId: string,
  opts: {
    propertyId: string
    title: string
    instructions: string
    startDate: string
    lineItem: { name: string; description: string; unitPrice: number }
  },
): Promise<CreatedJob> {
  const input: Record<string, unknown> = {
    propertyId: opts.propertyId,
    invoicing: { invoicingType: 'FIXED_PRICE', invoicingSchedule: 'ON_COMPLETION' },
    title: opts.title,
    instructions: opts.instructions,
    timeframe: { startAt: opts.startDate },
    lineItems: [
      {
        name: opts.lineItem.name,
        description: opts.lineItem.description,
        unitPrice: opts.lineItem.unitPrice,
        quantity: 1,
        // Never mint a new product from a booking — the catalog is the office's.
        saveToProductsAndServices: false,
      },
    ],
  }
  const resp = await jobberGraphQLAdmin<{
    data?: { jobCreate?: { job?: { id: string; jobNumber: string | null; title: string } | null; userErrors?: { message: string }[] } }
  }>(jobberUserId, JOB_CREATE, { input })

  const errs = resp.data?.jobCreate?.userErrors ?? []
  if (errs.length) throw new Error(errs.map((e) => e.message).join('; '))
  const job = resp.data?.jobCreate?.job
  if (!job?.id) throw new Error('jobCreate returned no job')
  return { id: job.id, jobNumber: job.jobNumber, title: job.title }
}

/**
 * Put the visit on the calendar.
 *
 * ⚠ `time` is omitted when no window was agreed, which is what makes it an ANYTIME
 * visit. That is not a shortcut: the company's own catalog says "The visit itself is
 * always Anytime. A PTF never means a timed appointment slot in Jobber." A promised
 * time frame belongs in the TITLE for the office, not on the visit.
 */
export async function createJobberVisit(
  jobberUserId: string,
  opts: {
    jobId: string
    date: string
    startHHMM?: string
    endHHMM?: string
    timezone: string
    assignedUserIds: string[]
  },
): Promise<void> {
  const schedule: Record<string, unknown> = {
    startAt: {
      date: opts.date,
      timezone: opts.timezone,
      ...(opts.startHHMM ? { time: `${opts.startHHMM}:00` } : {}),
    },
  }
  if (opts.endHHMM) {
    schedule.endAt = { date: opts.date, time: `${opts.endHHMM}:00`, timezone: opts.timezone }
  }
  if (opts.assignedUserIds.length) schedule.teamMemberIdsToAssign = opts.assignedUserIds

  const resp = await jobberGraphQLAdmin<{
    data?: { visitCreate?: { createdVisits?: { id: string }[]; userErrors?: { message: string }[] } }
  }>(jobberUserId, VISIT_CREATE, { jobId: opts.jobId, input: { visits: [schedule ? { schedule } : {}] } })

  const errs = resp.data?.visitCreate?.userErrors ?? []
  if (errs.length) throw new Error(errs.map((e) => e.message).join('; '))
}

/**
 * The client's property to hang the job on.
 *
 * Tries the local Jobber mirror FIRST, and not merely as an optimisation: the
 * property their existing jobs actually sit on is a better answer than "their first
 * property", and it costs no Jobber round-trip on a live call. The API is the
 * fallback for a client with no synced jobs.
 *
 * ⚠ `client.properties` is a PLAIN LIST, not a Relay connection — it takes no
 * `first:` argument and has no `nodes`. Asking for either fails the whole query with
 * `argumentNotAccepted` / `undefinedField`, which is how this returned null for every
 * customer on the first cut and would have refused every booking.
 */
export async function primaryPropertyId(
  admin: SupabaseClient,
  companyId: string,
  jobberUserId: string,
  jobberClientId: string,
): Promise<string | null> {
  try {
    const { data } = await admin
      .from('jobs')
      .select('property_external_id')
      .eq('company_id', companyId)
      .eq('client_external_id', jobberClientId)
      .not('property_external_id', 'is', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
    const fromMirror = (data as { property_external_id: string | null }[] | null)?.[0]?.property_external_id
    if (fromMirror) return fromMirror
  } catch {
    // fall through to Jobber
  }

  const resp = await jobberGraphQLAdmin<{
    data?: { client?: { properties?: { id: string }[] } }
  }>(
    jobberUserId,
    `query AmberClientProperty($id: EncodedId!) {
       client(id: $id) { properties { id } }
     }`,
    { id: jobberClientId },
  )
  return resp.data?.client?.properties?.[0]?.id ?? null
}
