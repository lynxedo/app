// One tech's day, pulled LIVE from Jobber: visits, assessments and tasks.
// Moved out of app/api/visits/route.ts (the Route Optimizer's pull) so Dispatch
// reads a day exactly the way the optimizer does. With `extended`, visits also
// carry their own title, the anytime flag, completion and Jobber's arrival window.

import { jobberGraphQLAdmin } from '@/lib/jobber'
import { tzOffset } from '@/lib/tz'

// ── Visits query ─────────────────────────────────────────────────────────────
const VISITS_QUERY = `
  query GetVisitsForRoute($filter: VisitFilterAttributes) {
    visits(first: 50, filter: $filter) {
      nodes {
        id
        startAt
        endAt
        client {
          name
          phones { number }
        }
        property {
          address {
            street1
            city
            province
            postalCode
          }
        }
        lineItems(first: 10) {
          nodes {
            name
            quantity
            unitPrice
            totalPrice
          }
        }
        job {
          id
          title
          instructions
          customFields {
            ... on CustomFieldText {
              label
              valueText
            }
            ... on CustomFieldNumeric {
              label
              valueNumeric
            }
          }
        }
      }
    }
  }
`

// Dispatch asks for a few more visit fields than the optimizer: the visit's own
// title (Heroes writes "Promised …" there, not on the job), Jobber's anytime flag
// (allDay), completion, and Jobber's arrival window. Kept as a separate query so
// the optimizer's request is byte-identical to before; if Jobber ever rejects
// the extra fields the caller falls back to the plain query.
const VISITS_QUERY_EXTENDED = VISITS_QUERY.replace(
  '        endAt\n        client {',
  '        endAt\n        title\n        allDay\n        isComplete\n        arrivalWindow { startAt endAt }\n        client {',
)

// ── Assessments query ────────────────────────────────────────────────────────
const ASSESSMENTS_QUERY = `
  query GetAssessments($filter: ScheduledItemsFilterAttributes!) {
    scheduledItems(filter: $filter, first: 50) {
      nodes {
        ... on Assessment {
          id
          title
          startAt
          endAt
          instructions
          client {
            name
            phones { number }
          }
          property {
            street
            city
            province
            postalCode
          }
        }
      }
    }
  }
`

// ── Tasks query ──────────────────────────────────────────────────────────────
// A Jobber Task is a scheduled item that is not a job: "swing by and look at the
// backflow", "pick up parts on the way home". It carries no line items and no
// price, and it may have no property at all.
const TASKS_QUERY = `
  query GetTasks($filter: ScheduledItemsFilterAttributes!) {
    scheduledItems(filter: $filter, first: 50) {
      nodes {
        ... on Task {
          id
          title
          instructions
          startAt
          endAt
          allDay
          isComplete
          client {
            name
            phones { number }
          }
          property {
            address {
              street1
              city
              province
              postalCode
            }
          }
        }
      }
    }
  }
`

type StopType = 'visit' | 'assessment' | 'task'

interface JobberVisit {
  id: string; startAt: string | null; endAt: string | null
  // Present only on the extended (Dispatch) query.
  title?: string | null; allDay?: boolean; isComplete?: boolean
  arrivalWindow?: { startAt: string; endAt: string } | null
  client: { name: string; phones: Array<{ number: string }> }
  property: { address: { street1: string; city: string; province: string; postalCode: string } }
  lineItems: { nodes: Array<{ name: string; quantity: number; unitPrice: number; totalPrice: number }> }
  job: {
    id: string; title: string; instructions: string | null
    customFields: Array<{ label: string; valueText?: string; valueNumeric?: number }>
  }
}

interface JobberAssessment {
  id: string; title: string | null; startAt: string | null; endAt: string | null
  instructions: string | null
  client: { name: string; phones: Array<{ number: string }> }
  property: { street: string; city: string; province: string; postalCode: string }
}

interface JobberTask {
  id: string; title: string | null; startAt: string | null; endAt: string | null
  instructions: string | null; allDay: boolean; isComplete: boolean
  client: { name: string; phones: Array<{ number: string }> } | null
  property: { address: { street1: string; city: string; province: string; postalCode: string } } | null
}

function formatStop(type: StopType, i: number, data: {
  id: string; clientName: string; phone: string | null
  addressString: string; services: string; totalPrice: number
  lineItems: Array<{ name: string; qty: number; unitPrice: number; totalPrice: number }>
  lineItemNames: string[]
  jobTitle: string; instructions: string | null
  startAt: string | null; endAt: string | null; type: StopType
  jobId: string | null
  /** False when the stop has no address to drive to — a task like "pick up
   *  parts". Unroutable stops are kept and shown, but never optimized. */
  routable: boolean
  // Extended (Dispatch) fields — absent on the optimizer's plain pull.
  visitTitle?: string | null
  allDay?: boolean
  isComplete?: boolean
  arrivalStart?: string | null
  arrivalEnd?: string | null
}) {
  return { stopNumber: i + 1, ...data }
}

// Heroes' operating timezone. Jobber reads a bare datetime (e.g.
// "2026-06-23T00:00:00") as UTC, so a day window built that way is shifted ~5-6h
// and an all-day item from the adjacent day overlaps it — which leaked a Monday
// assessment into a Tuesday pull (test-findings #8). Build the bounds with the
// correct local offset instead (DST-aware).
const ROUTING_TZ = 'America/Chicago'

function localDayBounds(date: string, timeZone = ROUTING_TZ): { start: string; end: string } {
  const offset = tzOffset(date, timeZone)
  return { start: `${date}T00:00:00${offset}`, end: `${date}T23:59:59${offset}` }
}

// Confirmed from the served prod build's own log on Sep 17 2026
// ("[visits] ScheduledItemType for tasks resolved to BASIC_TASK") and by the
// query then returning a real task. No longer a guess.
const TASK_ITEM_TYPE = 'BASIC_TASK'

type ScheduledItemsResponse = {
  data?: { scheduledItems?: { nodes?: Array<Record<string, unknown>> } }
  errors?: Array<{ message: string }>
}

async function fetchTasks(
  jobberUserId: string, dayStart: string, dayEnd: string, assignedTo: string,
): Promise<JobberTask[]> {
  const res = await jobberGraphQLAdmin<ScheduledItemsResponse>(
    jobberUserId, TASKS_QUERY,
    { filter: {
      scheduleItemType: TASK_ITEM_TYPE,
      occursWithin: { startAt: dayStart, endAt: dayEnd },
      assignedTo: [assignedTo],
    }},
  ).catch((err: unknown) => {
    console.warn(`[visits] tasks request threw: ${err instanceof Error ? err.message : String(err)}`)
    return null
  })

  if (res?.errors?.length) {
    // Loud on purpose: a task quietly not arriving is indistinguishable from a
    // day that simply has none, and that cost a round of wrong diagnosis.
    console.warn(`[visits] tasks query rejected: ${res.errors[0].message}`)
    return []
  }

  // Tasks are additive — a failure here must not cost the caller their visits.
  return (res?.data?.scheduledItems?.nodes ?? []) as unknown as JobberTask[]
}

export type DayStop = ReturnType<typeof formatStop>

type VisitsResponse = { data: { visits: { nodes: JobberVisit[] } }; errors?: Array<{ message: string }> }

export async function fetchTechDayStops(
  jobberUserId: string,
  date: string,
  assignedTo: string,
  opts: { extended?: boolean } = {},
): Promise<{ stops: DayStop[]; truncated: boolean } | { error: string }> {
  const extended = opts.extended === true
  const { start: dayStart, end: dayEnd } = localDayBounds(date)
  const fetchVisits = (query: string) => jobberGraphQLAdmin<VisitsResponse>(
    jobberUserId, query,
    { filter: { startAt: { after: dayStart, before: dayEnd }, assignedTo } },
  )

  // Fetch visits, assessments and tasks in parallel
  const [firstVisitResult, assessResult, taskNodes] = await Promise.all([
    fetchVisits(extended ? VISITS_QUERY_EXTENDED : VISITS_QUERY),
    jobberGraphQLAdmin<{ data: { scheduledItems: { nodes: Array<Record<string, unknown>> } }; errors?: Array<{ message: string }> }>(
      jobberUserId, ASSESSMENTS_QUERY,
      { filter: {
        scheduleItemType: 'ASSESSMENT',
        occursWithin: { startAt: dayStart, endAt: dayEnd },
        assignedTo: [assignedTo],
      }}
    ).catch(() => null),  // assessments are optional — don't break if they fail
    fetchTasks(jobberUserId, dayStart, dayEnd, assignedTo),
  ])

  let visitResult = firstVisitResult

  // The extended fields are Dispatch-only extras — never let them cost the day.
  if (extended && visitResult.errors?.length) {
    console.warn(`[day-stops] extended visit query rejected, retrying plain: ${visitResult.errors[0].message}`)
    visitResult = await fetchVisits(VISITS_QUERY)
  }

  if (visitResult.errors?.length) return { error: visitResult.errors[0].message }

  const stops: ReturnType<typeof formatStop>[] = []

  // Map visits
  for (const v of visitResult.data.visits.nodes) {
    const addr = v.property?.address
    stops.push(formatStop('visit', stops.length, {
      id: v.id,
      clientName: v.client.name,
      phone: v.client.phones?.[0]?.number ?? null,
      addressString: addr
        ? `${addr.street1}, ${addr.city}, ${addr.province} ${addr.postalCode}`
        : 'No address',
      services: v.lineItems.nodes.map(li => li.name).join(', '),
      totalPrice: v.lineItems.nodes.reduce((s, li) => s + (li.totalPrice ?? 0), 0),
      lineItems: v.lineItems.nodes
        .filter(li => (li.totalPrice ?? 0) !== 0 || (li.quantity ?? 0) > 0)
        .map(li => ({ name: li.name, qty: li.quantity ?? 1, unitPrice: li.unitPrice ?? 0, totalPrice: li.totalPrice ?? 0 })),
      lineItemNames: v.lineItems.nodes.map(li => li.name),
      jobTitle: v.job?.title ?? '',
      instructions: v.job?.instructions ?? null,
      startAt: v.startAt, endAt: v.endAt,
      type: 'visit',
      jobId: v.job?.id ?? null,
      routable: !!addr,
      ...(extended ? {
        visitTitle: v.title ?? null,
        allDay: v.allDay ?? false,
        isComplete: v.isComplete ?? false,
        arrivalStart: v.arrivalWindow?.startAt ?? null,
        arrivalEnd: v.arrivalWindow?.endAt ?? null,
      } : {}),
    }))
  }

  // Map assessments
  const assessNodes = (assessResult?.data?.scheduledItems?.nodes ?? []) as unknown as JobberAssessment[]
  for (const a of assessNodes) {
    if (!a.id) continue  // skip empty inline fragments
    const prop = a.property
    stops.push(formatStop('assessment', stops.length, {
      id: a.id,
      clientName: a.client?.name ?? 'Assessment',
      phone: a.client?.phones?.[0]?.number ?? null,
      addressString: prop
        ? `${prop.street}, ${prop.city}, ${prop.province} ${prop.postalCode}`
        : 'No address',
      services: 'Assessment',
      totalPrice: 0,
      lineItems: [],
      lineItemNames: [],
      jobTitle: a.title ?? 'Assessment',
      instructions: a.instructions ?? null,
      startAt: a.startAt, endAt: a.endAt,
      type: 'assessment',
      jobId: null,
      routable: !!prop,
    }))
  }

  // Map tasks. A task is "stop here, but there's no job" — either at a client's
  // property (routable, sits in the route like any other stop) or attached to
  // nothing at all (a parts run), which has no address to optimize against.
  for (const t of taskNodes) {
    if (!t.id) continue          // skip empty inline fragments
    if (t.isComplete) continue   // already done — don't route someone to it
    const addr = t.property?.address
    const title = t.title?.trim() || 'Task'
    stops.push(formatStop('task', stops.length, {
      id: t.id,
      clientName: t.client?.name ?? title,
      phone: t.client?.phones?.[0]?.number ?? null,
      addressString: addr
        ? `${addr.street1}, ${addr.city}, ${addr.province} ${addr.postalCode}`
        : '',
      services: 'Task',
      totalPrice: 0,
      lineItems: [],
      lineItemNames: [],
      jobTitle: title,
      instructions: t.instructions ?? null,
      // An all-day task has no meaningful clock time; treating it as untimed
      // lets the optimizer place it rather than pinning it to midnight.
      startAt: t.allDay ? null : t.startAt,
      endAt: t.allDay ? null : t.endAt,
      type: 'task',
      jobId: null,
      routable: !!addr,
    }))
  }

  // Sort by startAt (timed visits first, then untimed). Stops with no address
  // rise to the TOP: they aren't part of the drive, so they can't sit between
  // two stops that are, and the top is where a tech reads them before setting
  // off (Ben's ask — "always the first on the list").
  stops.sort((a, b) => {
    if (a.routable !== b.routable) return a.routable ? 1 : -1
    if (a.startAt && b.startAt) return a.startAt.localeCompare(b.startAt)
    if (a.startAt) return -1
    if (b.startAt) return 1
    return 0
  })

  // Re-number after sort
  stops.forEach((s, i) => { s.stopNumber = i + 1 })

  // The visits/assessments queries cap at 50 each. Surface a flag so the UI can
  // warn that a (very busy) tech-day might have more stops than were returned.
  const truncated =
    visitResult.data.visits.nodes.length >= 50 || assessNodes.length >= 50 ||
    taskNodes.length >= 50
  if (truncated) console.warn(`[visits] 50-cap reached for user ${assignedTo} on ${date}`)

  return { stops, truncated }
}
