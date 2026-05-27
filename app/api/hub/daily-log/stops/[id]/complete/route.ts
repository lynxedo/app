import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { jobberGraphQL } from '@/lib/jobber'

interface VisitMutationResponse {
  data?: {
    visitComplete?: { visit: { id: string; isComplete: boolean } | null; userErrors: Array<{ message: string }> }
    visitUncomplete?: { visit: { id: string; isComplete: boolean } | null; userErrors: Array<{ message: string }> }
  }
  errors?: Array<{ message: string }>
}

const VISIT_COMPLETE_MUTATION = `
  mutation VisitComplete($visitId: EncodedId!) {
    visitComplete(visitId: $visitId) {
      visit { id isComplete }
      userErrors { message path }
    }
  }
`

const VISIT_UNCOMPLETE_MUTATION = `
  mutation VisitUncomplete($visitId: EncodedId!) {
    visitUncomplete(visitId: $visitId) {
      visit { id isComplete }
      userErrors { message path }
    }
  }
`

async function resolveStopOrError(stopId: string, userId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== userId) {
    return { error: 'Unauthorized', status: 401 as const }
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) {
    return { error: 'Profile not found', status: 404 as const }
  }

  // Fetch stop with its entry to verify company scope. Use admin client
  // because daily_log_stops only has a SELECT RLS policy via the
  // EXISTS(daily_log_entries WHERE company_id = my_company) check — the
  // user-session client would work for SELECT, but we need to do an UPDATE
  // and the admin client handles both consistently.
  const admin = createAdminClient()
  const { data: stop } = await admin
    .from('daily_log_stops')
    .select('id, entry_id, jobber_visit_id, status, daily_log_entries!inner(company_id)')
    .eq('id', stopId)
    .single()

  if (!stop) {
    return { error: 'Stop not found', status: 404 as const }
  }

  // PostgREST returns the inner join as an object or array depending on
  // schema-cache inference. Accept both shapes.
  const entry = Array.isArray(stop.daily_log_entries)
    ? stop.daily_log_entries[0]
    : stop.daily_log_entries
  if (!entry || entry.company_id !== profile.company_id) {
    return { error: 'Stop not found', status: 404 as const }
  }

  return { admin, stop, userId: user.id }
}

// ── Mark stop complete + push to Jobber ─────────────────────────────────────
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const resolved = await resolveStopOrError(id, user.id)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { admin, stop, userId } = resolved

  const nowIso = new Date().toISOString()

  // Flip local status first — local completion shouldn't depend on Jobber's
  // availability. If the Jobber push fails, we surface a warning but the
  // local state is authoritative for the tech's view.
  const { data: updated, error: updateErr } = await admin
    .from('daily_log_stops')
    .update({
      status: 'complete',
      completed_at: nowIso,
      completed_by: userId,
    })
    .eq('id', stop.id)
    .select('id, ord, status, completed_at, completed_by')
    .single()

  if (updateErr || !updated) {
    return NextResponse.json(
      { error: updateErr?.message ?? 'Failed to update stop' },
      { status: 500 },
    )
  }

  // Best-effort Jobber push
  let jobberWarning: string | null = null
  let jobberSuccess = false
  if (stop.jobber_visit_id) {
    try {
      const result = await jobberGraphQL<VisitMutationResponse>(
        userId,
        VISIT_COMPLETE_MUTATION,
        { visitId: stop.jobber_visit_id },
      )
      const userErrors = result.data?.visitComplete?.userErrors ?? []
      const apiErrors = result.errors ?? []
      if (userErrors.length > 0) {
        jobberWarning = `Jobber: ${userErrors.map(e => e.message).join('; ')}`
      } else if (apiErrors.length > 0) {
        jobberWarning = `Jobber: ${apiErrors.map(e => e.message).join('; ')}`
      } else {
        jobberSuccess = true
      }
    } catch (e) {
      jobberWarning = e instanceof Error
        ? `Jobber push failed — ${e.message}`
        : 'Jobber push failed (unknown error)'
    }
  }

  return NextResponse.json({
    stop: updated,
    jobber_pushed: jobberSuccess,
    jobber_warning: jobberWarning,
  })
}

// ── Undo: revert stop + push uncomplete to Jobber ──────────────────────────
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const resolved = await resolveStopOrError(id, user.id)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { admin, stop, userId } = resolved

  const { data: updated, error: updateErr } = await admin
    .from('daily_log_stops')
    .update({
      status: 'pending',
      completed_at: null,
      completed_by: null,
    })
    .eq('id', stop.id)
    .select('id, ord, status, completed_at, completed_by')
    .single()

  if (updateErr || !updated) {
    return NextResponse.json(
      { error: updateErr?.message ?? 'Failed to update stop' },
      { status: 500 },
    )
  }

  let jobberWarning: string | null = null
  let jobberSuccess = false
  if (stop.jobber_visit_id) {
    try {
      const result = await jobberGraphQL<VisitMutationResponse>(
        userId,
        VISIT_UNCOMPLETE_MUTATION,
        { visitId: stop.jobber_visit_id },
      )
      const userErrors = result.data?.visitUncomplete?.userErrors ?? []
      const apiErrors = result.errors ?? []
      if (userErrors.length > 0) {
        jobberWarning = `Jobber: ${userErrors.map(e => e.message).join('; ')}`
      } else if (apiErrors.length > 0) {
        jobberWarning = `Jobber: ${apiErrors.map(e => e.message).join('; ')}`
      } else {
        jobberSuccess = true
      }
    } catch (e) {
      jobberWarning = e instanceof Error
        ? `Jobber reopen failed — ${e.message}`
        : 'Jobber reopen failed (unknown error)'
    }
  }

  return NextResponse.json({
    stop: updated,
    jobber_pushed: jobberSuccess,
    jobber_warning: jobberWarning,
  })
}
