import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { jobberGraphQL } from '@/lib/jobber'
import { setRouteOrder, type ReorderResult } from '@/lib/jobber-playwright'
import { fanoutGuardianNotification } from '@/lib/guardian-post'

// #48 — DM all company admins when the Playwright reorder fails for every stop.
// Fire-and-forget (void). Bot constraints documented in lib/jobber-playwright.ts:
//   - JOBBER_BOT_EMAIL / JOBBER_BOT_PASSWORD must be set on the VPS
//   - 2FA must be disabled on the bot account
//   - Bot account needs access to the visits being reordered
async function alertReorderFailure(companyId: string, firstError: string) {
  try {
    const admin = createAdminClient()
    const { data: admins } = await admin
      .from('user_profiles')
      .select('id')
      .eq('company_id', companyId)
      .eq('role', 'admin')
    const ids = (admins ?? []).map((a: { id: string }) => a.id)
    if (!ids.length) return
    await fanoutGuardianNotification({
      companyId,
      userIds: ids,
      roomIds: [],
      body: `⚠️ Jobber route reorder failed for all stops.\nError: ${firstError}\n\nCheck the Jobber bot credentials (JOBBER_BOT_EMAIL/PASSWORD) and ensure 2FA is disabled on the bot account.`,
      admin,
    })
  } catch (e) {
    console.error('[reorder-jobber] failure alert failed', e)
  }
}

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
  // Optional: when set, each visit is moved to this date (YYYY-MM-DD) as an
  // Anytime visit via a date-only visitEditSchedule call BEFORE reassign + reorder.
  assigned_date?: unknown
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

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single<{ company_id: string }>()
  const companyId = profile?.company_id ?? ''

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

  const assignedDate =
    typeof body.assigned_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.assigned_date)
      ? body.assigned_date
      : null

  try {
    // Step 1: if a target date is provided, move each visit to that date as an
    // Anytime visit via a date-only visitEditSchedule (no time, no endAt).
    // Must run before the Playwright reorder chain since overrideOrder is
    // per-tech-per-day — the visits need to be on the right day first.
    const dateMoveErrors = new Map<string, string>()
    if (assignedDate) {
      for (const visitId of visitIds) {
        try {
          const moveRes = await jobberGraphQL<DateMoveResult>(user.id, DATE_MOVE_MUTATION, {
            id: visitId,
            input: { startAt: { date: assignedDate, timezone: TIMEZONE } },
          })
          const errs = moveRes?.data?.visitEditSchedule?.userErrors
          if (errs?.length) {
            dateMoveErrors.set(visitId, `Date move: ${errs[0].message}`)
          }
        } catch (err) {
          dateMoveErrors.set(
            visitId,
            `Date move: ${err instanceof Error ? err.message : 'unknown error'}`,
          )
        }
      }
    }

    // Step 2: if reassign requested, fire visitEditAssignedUsers via the
    // public OAuth API for every visit. We record per-visit assign failures
    // so the client can surface them — but we still attempt the reorder for
    // visits that succeeded, since partial success is better than nothing.
    const assignErrors = new Map<string, string>()
    if (assignedUserId) {
      for (const visitId of visitIds) {
        if (dateMoveErrors.has(visitId)) continue  // skip reassign if date move failed
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

    // Step 3: Playwright-driven anytime reorder.
    const reorderResults = await setRouteOrder(visitIds)

    // Merge: if date move or reassign failed for a visit, mark it failed.
    const results: ReorderResult[] = reorderResults.map(r => {
      const dateMoveErr = dateMoveErrors.get(r.visitId)
      if (dateMoveErr) return { visitId: r.visitId, success: false, error: dateMoveErr }
      const assignErr = assignErrors.get(r.visitId)
      if (assignErr) {
        return { visitId: r.visitId, success: false, error: assignErr }
      }
      return r
    })

    const allOk = results.every(r => r.success)

    // #48 — alert admins if every stop failed (bot creds broken, Jobber DOM change, etc.)
    if (!allOk && results.every(r => !r.success) && companyId) {
      void alertReorderFailure(companyId, results[0]?.error ?? 'unknown')
    }

    return NextResponse.json({ results, allOk })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
