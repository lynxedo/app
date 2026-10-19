import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { companyJobberUserId, jobberGraphQLAdmin } from '@/lib/jobber'

// Jobber users Dispatch can give a lane to — ACTIVE ones only (Ben, Oct 19
// 2026: the team picker listed every user Jobber has ever had). /api/users
// stays as it is for the optimizer and Admin → Routing.
//
// Jobber's UserStatusEnum values aren't listed by introspection, so the filter
// drops anything that reads as off (deactivated / disabled / archived /
// inactive) rather than keeping one guessed "active" value — a new status
// shows up instead of silently emptying the list.

const QUERY = `
  query DispatchUsers {
    users(first: 100) { nodes { id name { full } status } }
  }
`

type Resp = {
  data?: { users?: { nodes: Array<{ id: string; name: { full: string }; status: string | null }> } }
  errors?: Array<{ message: string }>
}

const OFF = /deactiv|disabl|archiv|inactive|removed|suspend/i
let loggedStatuses = false

export async function GET() {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const jobberUserId = await companyJobberUserId(auth.companyId, auth.userId)
  if (!jobberUserId) return NextResponse.json({ error: 'Jobber is not connected for your company' }, { status: 400 })

  const res = await jobberGraphQLAdmin<Resp>(jobberUserId, QUERY)
  if (res.errors?.length) return NextResponse.json({ error: res.errors[0].message }, { status: 400 })
  const nodes = res.data?.users?.nodes ?? []
  if (!loggedStatuses) {
    loggedStatuses = true
    console.log(`[dispatch/users] Jobber user statuses seen: ${[...new Set(nodes.map(n => n.status ?? 'null'))].join(', ')}`)
  }
  const users = nodes
    .filter(n => !OFF.test(n.status ?? ''))
    .map(n => ({ id: n.id, name: n.name.full }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json({ users })
}
