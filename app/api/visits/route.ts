import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { jobberGraphQLAdmin, companyJobberUserId } from '@/lib/jobber'
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
//
// ⚠ This uses the ROOT `tasks` query, not `scheduledItems`. scheduledItems
// scopes to the AUTHENTICATED user unless you pass `schedulingAspects` — and we
// authenticate as the company's connected Jobber account, not as the tech whose
// day is being built. So it returned nothing for anyone but the connected user,
// which is exactly how this shipped broken. `tasks` takes the same filter shape
// as `visits` (which is why visits always worked for every tech): a
// `{ after, before }` range and a SINGULAR assignedTo id.
const TASKS_QUERY = `
  query GetTasksForRoute($filter: TaskFilterAttributes) {
    tasks(first: 50, filter: $filter) {
      nodes {
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
`

type StopType = 'visit' | 'assessment' | 'task'

interface JobberVisit {
  id: string; startAt: string | null; endAt: string | null
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

type TasksResponse = {
  data?: { tasks?: { nodes?: JobberTask[] } }
  errors?: Array<{ message: string }>
}

async function fetchTasks(
  jobberUserId: string, dayStart: string, dayEnd: string, assignedTo: string,
): Promise<JobberTask[]> {
  const res = await jobberGraphQLAdmin<TasksResponse>(
    jobberUserId, TASKS_QUERY,
    { filter: { startAt: { after: dayStart, before: dayEnd }, assignedTo } },
  ).catch((err: unknown) => {
    console.warn(`[visits] tasks request threw: ${err instanceof Error ? err.message : String(err)}`)
    return null
  })

  if (res?.errors?.length) {
    // Loud on purpose. The first version of this failed silently — it returned a
    // valid empty list — and the feature looked shipped while pulling nothing.
    console.warn(`[visits] tasks query rejected: ${res.errors[0].message}`)
    return []
  }

  const nodes = res?.data?.tasks?.nodes ?? []
  if (!res?.data?.tasks) {
    console.warn('[visits] tasks returned no data block; returning visits/assessments only')
    return []
  }
  return nodes
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  const assignedTo = searchParams.get('userId')

  if (!date || !assignedTo)
    return NextResponse.json({ error: 'date and userId are required' }, { status: 400 })

  const { start: dayStart, end: dayEnd } = localDayBounds(date)

  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { companyId, userId } = auth

  // Jobber is connected per COMPANY, not per user. `jobber_tokens` is RLS'd to
  // `auth.uid() = user_id`, so asking for the signed-in user's own token answers
  // "did *I* personally connect Jobber" — null for everyone except the one person
  // who did. Resolve the company's connected account and go through the admin
  // client instead (see companyJobberUserId in lib/jobber.ts).
  const jobberUserId = await companyJobberUserId(companyId, userId)
  if (!jobberUserId) {
    return NextResponse.json({ error: 'Jobber is not connected for your company' }, { status: 400 })
  }

  try {
    // Fetch visits, assessments and tasks in parallel
    const [visitResult, assessResult, taskNodes] = await Promise.all([
      jobberGraphQLAdmin<{ data: { visits: { nodes: JobberVisit[] } }; errors?: Array<{ message: string }> }>(
        jobberUserId, VISITS_QUERY,
        { filter: { startAt: { after: dayStart, before: dayEnd }, assignedTo } }
      ),
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

    if (visitResult.errors?.length)
      return NextResponse.json({ error: visitResult.errors[0].message }, { status: 400 })

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
    let tasksSkippedComplete = 0
    for (const t of taskNodes) {
      if (!t.id) continue          // skip empty inline fragments
      if (t.isComplete) { tasksSkippedComplete++; continue }  // don't route someone to finished work
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

    // One line per load, so "the task didn't show" is answerable from the log
    // instead of a guess: it separates "Jobber returned nothing" from "we filtered
    // it out", which is the distinction the first version of this could not make.
    if (taskNodes.length > 0 || tasksSkippedComplete > 0) {
      console.info(`[visits] tasks: ${taskNodes.length} returned, ${tasksSkippedComplete} skipped as complete, for user ${assignedTo} on ${date}`)
    }

    // Sort by startAt (timed visits first, then untimed). Stops with no address
    // sink to the bottom — they aren't part of the drive, so they shouldn't sit
    // between two stops that are.
    stops.sort((a, b) => {
      if (a.routable !== b.routable) return a.routable ? -1 : 1
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

    return NextResponse.json({ visits: stops, truncated })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
