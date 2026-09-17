import { NextRequest, NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { jobberGraphQLAdmin, companyJobberUserId } from '@/lib/jobber'

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
  // Parallel to visit_ids. Jobber has one mutation per kind of scheduled item
  // and they are not interchangeable. Absent for older callers and for batches
  // parked before tasks existed — those only ever held visits.
  visit_types?: unknown
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

// Tasks and assessments move days through their own mutations. In both, omitting
// the time (or setting allDay) is what makes the item "Anytime" on that date.
const TASK_MOVE_MUTATION = `
  mutation TaskMoveDay($id: EncodedId!, $input: TaskEditInput!) {
    taskEdit(id: $id, input: $input) {
      task { id }
      userErrors { message }
    }
  }
`

interface TaskMoveResult {
  data?: { taskEdit: { task: { id: string } | null; userErrors: Array<{ message: string }> } }
  errors?: Array<{ message: string }>
}

const ASSESSMENT_MOVE_MUTATION = `
  mutation AssessmentMoveDay($id: EncodedId!, $input: AssessmentEditInput!) {
    assessmentEdit(id: $id, input: $input) {
      assessment { id }
      userErrors { message }
    }
  }
`

interface AssessmentMoveResult {
  data?: { assessmentEdit: { assessment: { id: string } | null; userErrors: Array<{ message: string }> } }
  errors?: Array<{ message: string }>
}

// taskEdit takes a real ISO8601DateTime, so a bare date would be read as UTC.
function tzOffset(date: string, timeZone = TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, timeZoneName: 'longOffset',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(`${date}T12:00:00Z`))
  const name = parts.find(p => p.type === 'timeZoneName')?.value ?? ''
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/)
  if (!m) return '-06:00'
  return `${m[1]}${m[2]}:${m[3] ?? '00'}`
}

export async function POST(req: NextRequest) {
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

  // Parallel array; anything missing or unrecognised is treated as a visit,
  // which is what every caller sent before tasks existed.
  const rawTypes = Array.isArray(body.visit_types) ? body.visit_types : []
  const visitTypes = visitIds.map((_, i) =>
    rawTypes[i] === 'task' || rawTypes[i] === 'assessment' ? rawTypes[i] as 'task' | 'assessment' : 'visit')

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

    for (const [idx, visitId] of visitIds.entries()) {
      let error: string | null = null
      const stopType = visitTypes[idx]

      // Tasks and assessments do both steps in one mutation, so they short-circuit
      // the visit path below entirely.
      if (stopType === 'task') {
        try {
          const res = await jobberGraphQLAdmin<TaskMoveResult>(jobberUserId, TASK_MOVE_MUTATION, {
            id: visitId,
            input: {
              ...(assignedDate
                ? { startAt: `${assignedDate}T00:00:00${tzOffset(assignedDate)}`, allDay: true }
                : {}),
              ...(assignedUserId ? { assignedTo: [assignedUserId] } : {}),
            },
          })
          const errs = res?.data?.taskEdit?.userErrors ?? res?.errors
          if (errs?.length) error = errs[0].message
        } catch (err) {
          error = err instanceof Error ? err.message : 'unknown error'
        }
        results.push({ visitId, success: !error, error: error ?? undefined })
        continue
      }

      if (stopType === 'assessment') {
        try {
          const res = await jobberGraphQLAdmin<AssessmentMoveResult>(jobberUserId, ASSESSMENT_MOVE_MUTATION, {
            id: visitId,
            input: {
              schedule: {
                // No `time` key — that is what makes it Anytime on the date.
                ...(assignedDate ? { startAt: { date: assignedDate, timezone: TIMEZONE } } : {}),
                ...(assignedUserId ? { teamMemberIdsToAssign: [assignedUserId] } : {}),
              },
            },
          })
          const errs = res?.data?.assessmentEdit?.userErrors ?? res?.errors
          if (errs?.length) error = errs[0].message
        } catch (err) {
          error = err instanceof Error ? err.message : 'unknown error'
        }
        results.push({ visitId, success: !error, error: error ?? undefined })
        continue
      }

      // Step 1: move to the target date as an Anytime visit (date only, no time).
      if (assignedDate) {
        try {
          const moveRes = await jobberGraphQLAdmin<DateMoveResult>(jobberUserId, DATE_MOVE_MUTATION, {
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
          const assignRes = await jobberGraphQLAdmin<AssignMutationResult>(jobberUserId, ASSIGN_MUTATION, {
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
