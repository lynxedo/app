import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { jobberGraphQL } from '@/lib/jobber'

// "Send day + team to Jobber" — pushes each visit's DAY and TECH ASSIGNMENT back
// to Jobber via the official OAuth API, leaving the stops as "anytime" (no clock
// times) and WITHOUT reordering them inside Jobber.
//
// Why no reorder: Jobber's public API has no mutation to set the order of
// "anytime" visits. The old "Send Order Only" feature drove Jobber's internal
// web session with a headless browser to do it, but Jobber now puts Cloudflare
// bot protection in front of that, which blocks the server (and automating the
// internal endpoint is against Jobber's terms). So the optimized ORDER now lives
// in Lynxedo's Daily Log / route sheet, and only the day + tech (which can change
// during optimization) are written back to Jobber here. Crews follow the order
// in Lynxedo; to also see times in Jobber, use "Send with times" instead.

export const runtime = 'nodejs'
export const maxDuration = 30

interface AssignRequest {
  visit_ids?: unknown
  // When set, every visit is reassigned to this Jobber user.
  assigned_user_id?: unknown
  // When set, every visit is moved to this date (YYYY-MM-DD) as an Anytime visit
  // (date only, no time).
  assigned_date?: unknown
}

interface AssignResultRow {
  visitId: string
  success: boolean
  error?: string
}

const TIMEZONE = 'America/Chicago'

const DATE_MOVE_MUTATION = `
  mutation VisitEditScheduleAnytime($id: EncodedId!, $input: VisitEditScheduleInput!) {
    visitEditSchedule(id: $id, input: $input) {
      visit { id }
      userErrors { message }
    }
  }
`

interface DateMoveResult {
  data: {
    visitEditSchedule: {
      visit: { id: string } | null
      userErrors: Array<{ message: string }>
    }
  }
  errors?: Array<{ message: string }>
}

const ASSIGN_MUTATION = `
  mutation VisitEditAssignedUsers($visitId: EncodedId!, $input: VisitEditAssignedUsersInput!) {
    visitEditAssignedUsers(visitId: $visitId, input: $input) {
      visit { id }
      userErrors { message }
    }
  }
`

interface AssignMutationResult {
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

  let body: AssignRequest
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

  const assignedDate =
    typeof body.assigned_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.assigned_date)
      ? body.assigned_date
      : null

  if (!assignedDate && !assignedUserId) {
    return NextResponse.json(
      { error: 'Nothing to send — provide a target day and/or a tech to assign.' },
      { status: 400 },
    )
  }

  try {
    const results: AssignResultRow[] = []

    for (const visitId of visitIds) {
      let error: string | null = null

      // Step 1: move to the target date as an Anytime visit (date only, no time).
      if (assignedDate) {
        try {
          const moveRes = await jobberGraphQL<DateMoveResult>(user.id, DATE_MOVE_MUTATION, {
            id: visitId,
            input: { startAt: { date: assignedDate, timezone: TIMEZONE } },
          })
          const errs = moveRes?.data?.visitEditSchedule?.userErrors
          if (errs?.length) error = `Date move: ${errs[0].message}`
        } catch (err) {
          error = `Date move: ${err instanceof Error ? err.message : 'unknown error'}`
        }
      }

      // Step 2: reassign to the target tech (skip if the date move already failed).
      if (!error && assignedUserId) {
        try {
          const assignRes = await jobberGraphQL<AssignMutationResult>(user.id, ASSIGN_MUTATION, {
            visitId,
            input: { assignedUserIds: [assignedUserId] },
          })
          const errs = assignRes?.data?.visitEditAssignedUsers?.userErrors
          if (errs?.length) error = `Reassign: ${errs[0].message}`
        } catch (err) {
          error = `Reassign: ${err instanceof Error ? err.message : 'unknown error'}`
        }
      }

      results.push({ visitId, success: !error, error: error ?? undefined })
    }

    const allOk = results.every(r => r.success)
    return NextResponse.json({ results, allOk })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
