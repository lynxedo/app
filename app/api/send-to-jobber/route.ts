import { NextRequest, NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { jobberGraphQLAdmin, companyJobberUserId } from '@/lib/jobber'

interface VisitUpdate {
  visitId: string
  startAt: string  // "YYYY-MM-DDTHH:MM:SS" local time (America/Chicago)
  endAt: string    // "YYYY-MM-DDTHH:MM:SS" local time (America/Chicago)
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
