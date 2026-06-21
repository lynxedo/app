import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { jobberGraphQL } from '@/lib/jobber'

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

function formatStop(type: 'visit' | 'assessment', i: number, data: {
  id: string; clientName: string; phone: string | null
  addressString: string; services: string; totalPrice: number
  lineItems: Array<{ name: string; qty: number; unitPrice: number; totalPrice: number }>
  lineItemNames: string[]
  jobTitle: string; instructions: string | null
  startAt: string | null; endAt: string | null; type: 'visit' | 'assessment'
  jobId: string | null
}) {
  return { stopNumber: i + 1, ...data }
}

// Heroes' operating timezone. Jobber reads a bare datetime (e.g.
// "2026-06-23T00:00:00") as UTC, so a day window built that way is shifted ~5-6h
// and an all-day item from the adjacent day overlaps it — which leaked a Monday
// assessment into a Tuesday pull (test-findings #8). Build the bounds with the
// correct local offset instead (DST-aware).
const ROUTING_TZ = 'America/Chicago'

function tzOffset(date: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, timeZoneName: 'longOffset',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(`${date}T12:00:00Z`))
  const name = parts.find(p => p.type === 'timeZoneName')?.value ?? ''
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/)
  if (!m) return '-06:00' // CST fallback
  return `${m[1]}${m[2]}:${m[3] ?? '00'}`
}

function localDayBounds(date: string, timeZone = ROUTING_TZ): { start: string; end: string } {
  const offset = tzOffset(date, timeZone)
  return { start: `${date}T00:00:00${offset}`, end: `${date}T23:59:59${offset}` }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  const assignedTo = searchParams.get('userId')

  if (!date || !assignedTo)
    return NextResponse.json({ error: 'date and userId are required' }, { status: 400 })

  const { start: dayStart, end: dayEnd } = localDayBounds(date)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Fetch visits and assessments in parallel
    const [visitResult, assessResult] = await Promise.all([
      jobberGraphQL<{ data: { visits: { nodes: JobberVisit[] } }; errors?: Array<{ message: string }> }>(
        user.id, VISITS_QUERY,
        { filter: { startAt: { after: dayStart, before: dayEnd }, assignedTo } }
      ),
      jobberGraphQL<{ data: { scheduledItems: { nodes: Array<Record<string, unknown>> } }; errors?: Array<{ message: string }> }>(
        user.id, ASSESSMENTS_QUERY,
        { filter: {
          scheduleItemType: 'ASSESSMENT',
          occursWithin: { startAt: dayStart, endAt: dayEnd },
          assignedTo: [assignedTo],
        }}
      ).catch(() => null),  // assessments are optional — don't break if they fail
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
      }))
    }

    // Sort by startAt (timed visits first, then untimed)
    stops.sort((a, b) => {
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
      visitResult.data.visits.nodes.length >= 50 || assessNodes.length >= 50
    if (truncated) console.warn(`[visits] 50-cap reached for user ${assignedTo} on ${date}`)

    return NextResponse.json({ visits: stops, truncated })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
