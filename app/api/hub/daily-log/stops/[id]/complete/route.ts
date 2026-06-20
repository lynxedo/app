import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { jobberGraphQLAdmin, companyJobberUserId } from '@/lib/jobber'
import { evaluateEventAutomations } from '@/lib/automations'
import type { WeatherSnapshot } from '@/lib/nws-weather'
import { matchChemicalsForLineItems } from '@/lib/pesticide'
import { applyRouteSprayDecrements } from '@/lib/inventory'
import type { StoredRouteLoadout } from '@/lib/route-capacity'
import type { SupabaseClient } from '@supabase/supabase-js'

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

type LineItem = {
  name?: string
  qty?: number
  unitPrice?: number
  totalPrice?: number
}

type StopRow = {
  id: string
  entry_id: string
  jobber_visit_id: string | null
  client_name: string
  client_phone: string | null
  address: string
  lat: number | null
  lng: number | null
  line_items: LineItem[]
  status: string
  arrived_at: string | null
  pesticide_record_id: string | null
  pesticide_tech_notes: string | null
  weather: WeatherSnapshot | null
  daily_log_entries: {
    company_id: string
    log_date: string
    tech_user_id: string
  } | Array<{ company_id: string; log_date: string; tech_user_id: string }>
}

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
    .select('id, entry_id, jobber_visit_id, client_name, client_phone, address, lat, lng, line_items, status, arrived_at, pesticide_record_id, pesticide_tech_notes, weather, daily_log_entries!inner(company_id, log_date, tech_user_id)')
    .eq('id', stopId)
    .single<StopRow>()

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

  return { admin, stop, entry, userId: user.id, companyId: profile.company_id }
}

// Create or update the pesticide_records row for this stop. Idempotent on
// re-complete: if a record already exists (stop.pesticide_record_id set),
// UPDATE it in place instead of creating a duplicate. Records are never
// deleted on reopen — that's TDA-compliance design.
//
// Returns the record id, or null if no mappings matched (no record needed).
async function upsertPesticideRecord(args: {
  admin: SupabaseClient
  stop: StopRow
  entry: { company_id: string; tech_user_id: string }
  weather: WeatherSnapshot | null
  applicationTimestamp: string
  technicianName: string | null
  techNotes: string | null
}): Promise<string | null> {
  const { admin, stop, entry, weather, applicationTimestamp, technicianName, techNotes } = args

  // Session 9 — match against the unified service_products → products map
  // (single source of truth, PRD §8.8), the same matcher the Jobber webhook uses.
  const chemicalsApplied = await matchChemicalsForLineItems(admin, entry.company_id, stop.line_items)

  // No matches → no record. If a record already existed (e.g. line items
  // changed after the first completion to remove all chemical items) keep
  // the existing record; we don't delete compliance records here.
  if (chemicalsApplied.length === 0) return stop.pesticide_record_id ?? null

  const recordBody = {
    company_id: entry.company_id,
    stop_id: stop.id,
    daily_log_entry_id: stop.entry_id,
    application_timestamp: applicationTimestamp,
    location_address: stop.address,
    location_lat: stop.lat,
    location_lng: stop.lng,
    customer_name: stop.client_name,
    jobber_visit_id: stop.jobber_visit_id,
    technician_user_id: entry.tech_user_id,
    technician_name: technicianName,
    line_items: stop.line_items,
    chemicals_applied: chemicalsApplied,
    weather: weather,
    tech_notes: techNotes,
  }

  if (stop.pesticide_record_id) {
    // Update existing record in place — preserves the original record id,
    // refreshes timestamp + weather + chemicals to reflect the current state.
    const { error } = await admin
      .from('pesticide_records')
      .update(recordBody)
      .eq('id', stop.pesticide_record_id)
    if (error) return null
    return stop.pesticide_record_id
  }

  // No record tracked on the stop yet. If this stop has a Jobber visit, the
  // VISIT_COMPLETE webhook may have already created a record for it — upsert on
  // the (company_id, jobber_visit_id) dedup key so DL V2 ADOPTS and enriches it
  // (DL V2 is the primary path: real arrival-time weather + technician). Stops
  // without a Jobber visit (jobber_visit_id null) are excluded from the partial
  // unique index, so a plain insert is correct there.
  if (stop.jobber_visit_id) {
    const { data: upserted, error } = await admin
      .from('pesticide_records')
      .upsert(recordBody, { onConflict: 'company_id,jobber_visit_id' })
      .select('id')
      .single()
    if (error || !upserted) return null
    return upserted.id
  }

  const { data: inserted, error } = await admin
    .from('pesticide_records')
    .insert(recordBody)
    .select('id')
    .single()
  if (error || !inserted) return null
  return inserted.id
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
  const { admin, stop, entry, userId } = resolved

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
    .select('id, ord, status, arrived_at, completed_at, completed_by')
    .single()

  if (updateErr || !updated) {
    return NextResponse.json(
      { error: updateErr?.message ?? 'Failed to update stop' },
      { status: 500 },
    )
  }

  // Weather was captured at arrive time; use whatever is already on the stop.
  const weather = stop.weather

  // Best-effort pesticide-record creation/update. arrived_at is the
  // application-start time per TDA convention; fall back to completed_at
  // when the tech skipped the timer.
  const applicationTimestamp = stop.arrived_at ?? nowIso

  // Tech name for the record snapshot — fetch lazily here since the stop
  // resolve query didn't pull it.
  let technicianName: string | null = null
  {
    const { data: techRow } = await admin
      .from('hub_users')
      .select('display_name')
      .eq('id', entry.tech_user_id)
      .maybeSingle()
    technicianName = techRow?.display_name ?? null
  }

  const pesticideRecordId = await upsertPesticideRecord({
    admin,
    stop,
    entry,
    weather,
    applicationTimestamp,
    technicianName,
    techNotes: stop.pesticide_tech_notes,
  })

  // Persist the link back to the stop if we created/updated a record.
  if (pesticideRecordId && pesticideRecordId !== stop.pesticide_record_id) {
    await admin
      .from('daily_log_stops')
      .update({ pesticide_record_id: pesticideRecordId })
      .eq('id', stop.id)
  }

  // Detect if this was the last non-complete, non-skipped stop in the entry.
  let isLastStop = false
  {
    const { count } = await admin
      .from('daily_log_stops')
      .select('id', { count: 'exact', head: true })
      .eq('entry_id', stop.entry_id)
      .in('status', ['pending', 'in_progress'])
    isLastStop = (count ?? 0) === 0
  }

  // Best-effort Jobber push. DL5 — techs don't connect their own Jobber account,
  // so the visit must be completed through the company's connected account
  // (admin token), not the signed-in tech's (which is null → silent no-op).
  let jobberWarning: string | null = null
  let jobberSuccess = false
  if (stop.jobber_visit_id) {
    try {
      const jobberUserId = await companyJobberUserId(entry.company_id, userId)
      if (!jobberUserId) throw new Error('No connected Jobber account for this company')
      const result = await jobberGraphQLAdmin<VisitMutationResponse>(
        jobberUserId,
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

  // Session 10 — when the route's spraying is done (last stop complete), decrement
  // inventory from the route's stored loadout. Best-effort, non-blocking, idempotent.
  if (isLastStop) {
    void (async () => {
      const { data: entryRow } = await admin
        .from('daily_log_entries')
        .select('route_loadout')
        .eq('id', stop.entry_id)
        .maybeSingle<{ route_loadout: StoredRouteLoadout | null }>()
      const res = await applyRouteSprayDecrements({
        admin, companyId: entry.company_id, entryId: stop.entry_id,
        loadout: entryRow?.route_loadout ?? null,
      })
      console.log(`[inventory] route ${stop.entry_id} decrement:`, res)
    })().catch(err => console.error('[inventory] route decrement failed for', stop.entry_id, err))
  }

  // Fire any "daily log stop completed" automations (best-effort, non-blocking).
  void evaluateEventAutomations({
    companyId: entry.company_id,
    source: 'daily_log_stop_complete',
    actorUserId: entry.tech_user_id,
    vars: {
      tech_name: technicianName ?? '',
      customer: stop.client_name ?? '',
      address: stop.address ?? '',
      time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }),
      date: nowIso.slice(0, 10),
    },
  })

  return NextResponse.json({
    stop: {
      ...updated,
      weather,
      pesticide_record_id: pesticideRecordId,
    },
    jobber_pushed: jobberSuccess,
    jobber_warning: jobberWarning,
    is_last_stop: isLastStop,
  })
}

// ── Undo: revert stop + push uncomplete to Jobber ──────────────────────────
// Weather data + pesticide_record are intentionally NOT cleared on reopen —
// they're compliance/audit artifacts. Re-completion will refresh them.
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
  const { admin, stop, userId, companyId } = resolved

  // Reopen logic: if arrival was recorded, drop back to in_progress
  // (timer keeps running with the original arrived_at). Otherwise pending.
  const revertedStatus = stop.arrived_at ? 'in_progress' : 'pending'

  const { data: updated, error: updateErr } = await admin
    .from('daily_log_stops')
    .update({
      status: revertedStatus,
      completed_at: null,
      completed_by: null,
    })
    .eq('id', stop.id)
    .select('id, ord, status, arrived_at, completed_at, completed_by')
    .single()

  if (updateErr || !updated) {
    return NextResponse.json(
      { error: updateErr?.message ?? 'Failed to update stop' },
      { status: 500 },
    )
  }

  // DL5 — same as complete: reopen through the company's connected Jobber
  // account (admin token), not the tech's missing personal token.
  let jobberWarning: string | null = null
  let jobberSuccess = false
  if (stop.jobber_visit_id) {
    try {
      const jobberUserId = await companyJobberUserId(companyId, userId)
      if (!jobberUserId) throw new Error('No connected Jobber account for this company')
      const result = await jobberGraphQLAdmin<VisitMutationResponse>(
        jobberUserId,
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
