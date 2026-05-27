import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { jobberGraphQL } from '@/lib/jobber'
import { setRouteOrder, type ReorderResult } from '@/lib/jobber-playwright'

// Playwright launches Chromium — must run in the Node.js runtime.
export const runtime = 'nodejs'
// Browser launch + login + N mutations can take 10–30s on a cold call.
export const maxDuration = 60

interface ReorderRequest {
  visit_ids?: unknown
  // Optional: when set, all visits get reassigned to this Jobber user via the
  // public OAuth API BEFORE we run the editAppointment chain. Required when the
  // route was loaded from multiple techs — editAppointment's anytime ordering
  // only makes sense within a single tech's route.
  assigned_user_id?: unknown
}

const ASSIGN_MUTATION = `
  mutation VisitEditAssignedUsers($visitId: EncodedId!, $input: VisitEditAssignedUsersInput!) {
    visitEditAssignedUsers(visitId: $visitId, input: $input) {
      visit { id }
      userErrors { message }
    }
  }
`

interface AssignResult {
  data: {
    visitEditAssignedUsers: {
      visit: { id: string } | null
      userErrors: Array<{ message: string }>
    }
  }
  errors?: Array<{ message: string }>
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: ReorderRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const raw = body.visit_ids
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json({ error: 'visit_ids must be a non-empty array' }, { status: 400 })
  }
  if (raw.some(v => typeof v !== 'string' || v.length === 0)) {
    return NextResponse.json({ error: 'visit_ids must be strings' }, { status: 400 })
  }
  if (raw.length > 50) {
    return NextResponse.json({ error: 'Too many visits (max 50 per request)' }, { status: 400 })
  }
  const visitIds = raw as string[]

  const assignedUserId =
    typeof body.assigned_user_id === 'string' && body.assigned_user_id.length > 0
      ? body.assigned_user_id
      : null

  try {
    // Step 1: if reassign requested, fire visitEditAssignedUsers via the
    // public OAuth API for every visit. We record per-visit assign failures
    // so the client can surface them — but we still attempt the reorder for
    // visits that succeeded, since partial success is better than nothing.
    const assignErrors = new Map<string, string>()
    if (assignedUserId) {
      for (const visitId of visitIds) {
        try {
          const assignRes = await jobberGraphQL<AssignResult>(user.id, ASSIGN_MUTATION, {
            visitId,
            input: { assignedUserIds: [assignedUserId] },
          })
          const errs = assignRes?.data?.visitEditAssignedUsers?.userErrors
          if (errs?.length) {
            assignErrors.set(visitId, `Reassign: ${errs[0].message}`)
          }
        } catch (err) {
          assignErrors.set(
            visitId,
            `Reassign: ${err instanceof Error ? err.message : 'unknown error'}`,
          )
        }
      }
    }

    // Step 2: Playwright-driven anytime reorder.
    const reorderResults = await setRouteOrder(visitIds)

    // Merge: if reassign failed for a visit, mark that result as failed too.
    const results: ReorderResult[] = reorderResults.map(r => {
      const assignErr = assignErrors.get(r.visitId)
      if (assignErr) {
        return { visitId: r.visitId, success: false, error: assignErr }
      }
      return r
    })

    const allOk = results.every(r => r.success)
    return NextResponse.json({ results, allOk })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
