import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { companyJobberUserId, jobberGraphQLAdmin } from '@/lib/jobber'
import type { DispatchStop } from '@/lib/dispatch'

// Dispatch's Unscheduled bucket — Jobber's own "no home yet" visits, read LIVE.
// The Hub mirror never holds them: its visit sync filters on startAt, and an
// unscheduled visit has none. Jobber's UNSCHEDULED status filter also returns
// completed visits that never had a date, so those are dropped here.
//
// Cached per company (per PM2 process) for a few minutes: the bucket is browsed,
// not raced, and Jobber's rate budget is shared with the sync and Amber's live
// calls. After a send the screen asks with ?refresh=1 so a just-scheduled visit
// leaves the bucket at once.

const QUERY = `
  query DispatchUnscheduled($cursor: String) {
    visits(first: 40, after: $cursor, filter: { status: UNSCHEDULED }) {
      nodes {
        id
        title
        createdAt
        isComplete
        startAt
        client { name phones { number } }
        property { address { street1 city province postalCode } }
        lineItems(first: 10) { nodes { name totalPrice } }
        job { title instructions }
        assignedUsers(first: 5) { nodes { id } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

interface Node {
  id: string
  title: string | null
  createdAt: string
  isComplete: boolean
  startAt: string | null
  client: { name: string; phones: Array<{ number: string }> } | null
  property: { address: { street1: string; city: string; province: string; postalCode: string } | null } | null
  lineItems: { nodes: Array<{ name: string; totalPrice: number | null }> }
  job: { title: string | null; instructions: string | null } | null
  assignedUsers: { nodes: Array<{ id: string }> } | null
}

type Resp = {
  data?: { visits?: { nodes: Node[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }
  errors?: Array<{ message: string }>
}

const TTL_MS = 3 * 60 * 1000
const MAX_PAGES = 8
const cache = new Map<string, { at: number; stops: DispatchStop[]; truncated: boolean }>()

export async function GET(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const { companyId, userId } = auth

  const refresh = new URL(request.url).searchParams.get('refresh') === '1'
  const hit = cache.get(companyId)
  if (!refresh && hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ stops: hit.stops, truncated: hit.truncated, cachedAt: new Date(hit.at).toISOString() })
  }

  const jobberUserId = await companyJobberUserId(companyId, userId)
  if (!jobberUserId) return NextResponse.json({ error: 'Jobber is not connected for your company' }, { status: 400 })

  const stops: DispatchStop[] = []
  let cursor: string | null = null
  let truncated = false
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res: Resp = await jobberGraphQLAdmin<Resp>(jobberUserId, QUERY, { cursor })
      if (res.errors?.length) return NextResponse.json({ error: res.errors[0].message }, { status: 400 })
      const conn = res.data?.visits
      if (!conn) break
      for (const v of conn.nodes) {
        if (v.isComplete || v.startAt) continue
        const a = v.property?.address
        const items = v.lineItems?.nodes ?? []
        stops.push({
          id: v.id,
          kind: 'visit',
          clientName: v.client?.name ?? 'Unknown client',
          phone: v.client?.phones?.[0]?.number ?? null,
          address: a ? `${a.street1}, ${a.city}, ${a.province} ${a.postalCode}` : '',
          routable: !!a,
          title: (v.title ?? '').trim() || (v.job?.title ?? ''),
          lineItemNames: items.map(li => li.name),
          totalPrice: items.reduce((s, li) => s + (li.totalPrice ?? 0), 0),
          instructions: v.job?.instructions ?? null,
          startAt: null,
          endAt: null,
          allDay: true,
          isComplete: false,
          arrivalStart: null,
          arrivalEnd: null,
          techIds: (v.assignedUsers?.nodes ?? []).map(u => u.id),
          createdAt: v.createdAt,
        })
      }
      if (!conn.pageInfo.hasNextPage) break
      cursor = conn.pageInfo.endCursor
      if (page === MAX_PAGES - 1) truncated = true
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Jobber request failed' }, { status: 500 })
  }

  const at = Date.now()
  cache.set(companyId, { at, stops, truncated })
  return NextResponse.json({ stops, truncated, cachedAt: new Date(at).toISOString() })
}
