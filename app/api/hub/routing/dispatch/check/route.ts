import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { companyJobberUserId, jobberGraphQLAdmin } from '@/lib/jobber'

// Pre-send check for Dispatch. The draft was built from a read that may be
// minutes old, and two people can work the same day, so before anything is
// written we re-read each VISIT live from Jobber and report the ones that moved,
// were reassigned or were completed since — the screen holds those back instead
// of overwriting someone else's change. (Assessments and tasks have no bulk
// by-id read; they go through unchecked and the screen says so.)

const QUERY = `
  query DispatchCheck($ids: [EncodedId!]) {
    visits(first: 50, filter: { ids: $ids }) {
      nodes { id startAt isComplete assignedUsers(first: 5) { nodes { id } } }
    }
  }
`

type Resp = {
  data?: { visits?: { nodes: Array<{ id: string; startAt: string | null; isComplete: boolean; assignedUsers: { nodes: Array<{ id: string }> } | null }> } }
  errors?: Array<{ message: string }>
}

interface CheckItem { id: string; kind: string; fromStartAt: string | null; fromTechIds: string[] }

function sameInstant(a: string | null, b: string | null): boolean {
  if (!a || !b) return a === b
  return new Date(a).getTime() === new Date(b).getTime()
}

// The Day view only knows the assignees whose lanes it loaded, so "reassigned"
// means a tech the draft saw on the stop is no longer on it — not an exact match.
function stillAssigned(seen: string[], live: string[]): boolean {
  return seen.every(x => live.includes(x))
}

export async function POST(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const { companyId, userId } = auth

  const body = await request.json().catch(() => null) as { items?: CheckItem[] } | null
  const items = (body?.items ?? []).filter(i => i && typeof i.id === 'string').slice(0, 200)
  const visits = items.filter(i => i.kind === 'visit')

  const jobberUserId = await companyJobberUserId(companyId, userId)
  if (!jobberUserId) return NextResponse.json({ error: 'Jobber is not connected for your company' }, { status: 400 })

  const live = new Map<string, { startAt: string | null; isComplete: boolean; techIds: string[] }>()
  for (let i = 0; i < visits.length; i += 50) {
    const ids = visits.slice(i, i + 50).map(v => v.id)
    const res = await jobberGraphQLAdmin<Resp>(jobberUserId, QUERY, { ids })
    if (res.errors?.length) return NextResponse.json({ error: res.errors[0].message }, { status: 400 })
    for (const n of res.data?.visits?.nodes ?? []) {
      live.set(n.id, { startAt: n.startAt, isComplete: n.isComplete, techIds: (n.assignedUsers?.nodes ?? []).map(u => u.id) })
    }
  }

  const conflicts: Array<{ id: string; reason: string; liveStartAt: string | null; liveTechIds: string[] }> = []
  for (const v of visits) {
    const l = live.get(v.id)
    if (!l) { conflicts.push({ id: v.id, reason: 'gone', liveStartAt: null, liveTechIds: [] }); continue }
    if (l.isComplete) { conflicts.push({ id: v.id, reason: 'completed', liveStartAt: l.startAt, liveTechIds: l.techIds }); continue }
    if (!sameInstant(l.startAt, v.fromStartAt)) { conflicts.push({ id: v.id, reason: 'moved', liveStartAt: l.startAt, liveTechIds: l.techIds }); continue }
    if (!stillAssigned(v.fromTechIds ?? [], l.techIds)) conflicts.push({ id: v.id, reason: 'reassigned', liveStartAt: l.startAt, liveTechIds: l.techIds })
  }

  return NextResponse.json({
    conflicts,
    unchecked: items.filter(i => i.kind !== 'visit').map(i => i.id),
  })
}
