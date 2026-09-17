import { NextRequest, NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { jobberGraphQLAdmin, companyJobberUserId } from '@/lib/jobber'

interface VisitUpdate {
  visitId: string
  startAt: string  // "YYYY-MM-DDTHH:MM:SS" local time (America/Chicago)
  endAt: string    // "YYYY-MM-DDTHH:MM:SS" local time (America/Chicago)
  // Which kind of scheduled item this id belongs to. Jobber has a separate
  // mutation per kind and they are not interchangeable — handing an assessment
  // id to visitEditSchedule just returns a userError. Absent for older callers
  // (and for batches parked before tasks existed), which only ever sent visits.
  type?: 'visit' | 'assessment' | 'task'
}

interface SendToJobberRequest {
  visits: VisitUpdate[]
  assignedUserId?: string | null  // if set, reassign every visit to this user
}

interface JobberDT {
  date: string
  time: string
  timezone: string
}

const TIMEZONE = 'America/Chicago'

function toJobberDT(isoLocal: string): JobberDT {
  const [date, time] = isoLocal.split('T')
  return { date, time: time ?? '00:00:00', timezone: TIMEZONE }
}

// TaskEditInput takes a plain ISO8601DateTime rather than the {date,time,timezone}
// shape the visit and assessment mutations use, so a bare local string would be
// read as UTC and land the task 5-6 hours out. Stamp the real Chicago offset.
function tzOffset(date: string, timeZone = TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, timeZoneName: 'longOffset',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(`${date}T12:00:00Z`))
  const name = parts.find(p => p.type === 'timeZoneName')?.value ?? ''
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/)
  if (!m) return '-06:00' // CST fallback
  return `${m[1]}${m[2]}:${m[3] ?? '00'}`
}

function toJobberISO(isoLocal: string): string {
  const [date, time] = isoLocal.split('T')
  return `${date}T${time ?? '00:00:00'}${tzOffset(date)}`
}

const SCHEDULE_MUTATION = `
  mutation VisitEditSchedule($id: EncodedId!, $input: VisitEditScheduleInput!) {
    visitEditSchedule(id: $id, input: $input) {
      visit { id startAt endAt }
      userErrors { message }
    }
  }
`

const ASSIGN_MUTATION = `
  mutation VisitEditAssignedUsers($visitId: EncodedId!, $input: VisitEditAssignedUsersInput!) {
    visitEditAssignedUsers(visitId: $visitId, input: $input) {
      visit { id }
      userErrors { message }
    }
  }
`

interface ScheduleResult {
  data: {
    visitEditSchedule: {
      visit: { id: string; startAt: string; endAt: string } | null
      userErrors: Array<{ message: string }>
    }
  }
  errors?: Array<{ message: string }>
}

interface AssignResult {
  data: {
    visitEditAssignedUsers: {
      visit: { id: string } | null
      userErrors: Array<{ message: string }>
    }
  }
  errors?: Array<{ message: string }>
}

// A task takes its times AND its assignee in one mutation, unlike a visit.
const TASK_MUTATION = `
  mutation TaskEditSchedule($id: EncodedId!, $input: TaskEditInput!) {
    taskEdit(id: $id, input: $input) {
      task { id }
      userErrors { message }
    }
  }
`

interface TaskResult {
  data?: { taskEdit: { task: { id: string } | null; userErrors: Array<{ message: string }> } }
  errors?: Array<{ message: string }>
}

// An assessment nests its schedule (and its team assignment) under `schedule`.
const ASSESSMENT_MUTATION = `
  mutation AssessmentEditSchedule($id: EncodedId!, $input: AssessmentEditInput!) {
    assessmentEdit(id: $id, input: $input) {
      assessment { id }
      userErrors { message }
    }
  }
`

interface AssessmentResult {
  data?: { assessmentEdit: { assessment: { id: string } | null; userErrors: Array<{ message: string }> } }
  errors?: Array<{ message: string }>
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

  const { visits, assignedUserId }: SendToJobberRequest = await req.json()

  if (!visits || visits.length === 0) {
    return NextResponse.json({ error: 'No visits provided' }, { status: 400 })
  }

  const results: Array<{ visitId: string; success: boolean; error?: string }> = []

  for (const v of visits) {
    try {
      // Tasks and assessments are not visits — each has its own mutation, and
      // each sets the assignee in the same call rather than a second one.
      if (v.type === 'task') {
        const res = await jobberGraphQLAdmin<TaskResult>(jobberUserId, TASK_MUTATION, {
          id: v.visitId,
          input: {
            startAt: toJobberISO(v.startAt),
            endAt: toJobberISO(v.endAt),
            ...(assignedUserId ? { assignedTo: [assignedUserId] } : {}),
          },
        })
        const errs = res?.data?.taskEdit?.userErrors ?? res?.errors
        results.push(errs?.length
          ? { visitId: v.visitId, success: false, error: errs[0].message }
          : { visitId: v.visitId, success: true })
        continue
      }

      if (v.type === 'assessment') {
        const res = await jobberGraphQLAdmin<AssessmentResult>(jobberUserId, ASSESSMENT_MUTATION, {
          id: v.visitId,
          input: {
            schedule: {
              startAt: toJobberDT(v.startAt),
              endAt: toJobberDT(v.endAt),
              ...(assignedUserId ? { teamMemberIdsToAssign: [assignedUserId] } : {}),
            },
          },
        })
        const errs = res?.data?.assessmentEdit?.userErrors ?? res?.errors
        results.push(errs?.length
          ? { visitId: v.visitId, success: false, error: errs[0].message }
          : { visitId: v.visitId, success: true })
        continue
      }

      // 1. Set schedule (startAt + endAt)
      const schedResult = await jobberGraphQLAdmin<ScheduleResult>(jobberUserId, SCHEDULE_MUTATION, {
        id: v.visitId,
        input: {
          startAt: toJobberDT(v.startAt),
          endAt: toJobberDT(v.endAt),
        },
      })

      const schedErrors = schedResult?.data?.visitEditSchedule?.userErrors
      if (schedErrors?.length) {
        results.push({ visitId: v.visitId, success: false, error: schedErrors[0].message })
        continue
      }

      // 2. Optionally reassign tech
      if (assignedUserId) {
        const assignResult = await jobberGraphQLAdmin<AssignResult>(jobberUserId, ASSIGN_MUTATION, {
          visitId: v.visitId,
          input: { assignedUserIds: [assignedUserId] },
        })

        const assignErrors = assignResult?.data?.visitEditAssignedUsers?.userErrors
        if (assignErrors?.length) {
          results.push({ visitId: v.visitId, success: false, error: `Reassign: ${assignErrors[0].message}` })
          continue
        }
      }

      results.push({ visitId: v.visitId, success: true })
    } catch (err) {
      results.push({
        visitId: v.visitId,
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  const allOk = results.every(r => r.success)
  return NextResponse.json({ results, allOk })
}
