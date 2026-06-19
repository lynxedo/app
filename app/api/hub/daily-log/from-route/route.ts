import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface LineItemPayload {
  name: string
  qty: number
  unitPrice: number
  totalPrice: number
}

interface StopPayload {
  jobber_visit_id?: string | null
  client_name: string
  client_phone?: string | null
  address: string
  lat?: number | null
  lng?: number | null
  job_title?: string | null
  line_items?: LineItemPayload[]
  instructions?: string | null
  scheduled_start_at?: string | null
  scheduled_end_at?: string | null
  duration_minutes?: number | null
}

interface FromRouteRequest {
  log_date: string                // YYYY-MM-DD
  tech_jobber_user_id?: string    // for audit only — name match is the actual bridge
  tech_jobber_user_name: string   // matched against hub_users.display_name (first-token)
  stops: StopPayload[]
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const body = (await request.json()) as FromRouteRequest
  if (!body.log_date || typeof body.log_date !== 'string') {
    return NextResponse.json({ error: 'log_date required' }, { status: 400 })
  }
  if (!body.tech_jobber_user_name || typeof body.tech_jobber_user_name !== 'string') {
    return NextResponse.json({ error: 'tech_jobber_user_name required' }, { status: 400 })
  }
  if (!Array.isArray(body.stops) || body.stops.length === 0) {
    return NextResponse.json({ error: 'stops must be a non-empty array' }, { status: 400 })
  }

  // Resolve Jobber tech name → hub_users.id by first-token match.
  // Heroes convention: hub_users.display_name is first name only ("Ben",
  // "Kathryn"), Jobber uses full names ("Ben Simpson"). Same convention used
  // by the Chat Synx bridge for @mentions.
  const firstToken = body.tech_jobber_user_name.trim().split(/\s+/)[0]
  if (!firstToken) {
    return NextResponse.json({ error: 'Invalid tech name' }, { status: 400 })
  }

  const { data: matches } = await supabase
    .from('hub_users')
    .select('id, display_name')
    .eq('company_id', profile.company_id)
    .eq('is_bot', false)
    .ilike('display_name', `${firstToken}%`)

  const exactMatches = (matches ?? []).filter(
    m => m.display_name.split(/\s+/)[0].toLowerCase() === firstToken.toLowerCase(),
  )

  if (exactMatches.length === 0) {
    return NextResponse.json(
      { error: `No Hub user matches Jobber tech "${body.tech_jobber_user_name}". Add them in Hub or fix the display name.` },
      { status: 422 },
    )
  }
  if (exactMatches.length > 1) {
    const names = exactMatches.map(m => m.display_name).join(', ')
    return NextResponse.json(
      { error: `Multiple Hub users match "${firstToken}" (${names}). Make display names unique by first token.` },
      { status: 422 },
    )
  }
  const techUserId = exactMatches[0].id

  const admin = createAdminClient()

  // Find existing daily log entry for this {company, date, tech}, or create one.
  // Exclude soft-deleted tombstones — otherwise we'd push stops into a deleted
  // entry the list hides (and never create the live one the user expects).
  const { data: existingEntry } = await admin
    .from('daily_log_entries')
    .select('id')
    .eq('company_id', profile.company_id)
    .eq('log_date', body.log_date)
    .eq('tech_user_id', techUserId)
    .is('deleted_at', null)
    .maybeSingle()

  let entryId: string
  let action: 'created' | 'updated'

  if (existingEntry) {
    entryId = existingEntry.id
    action = 'updated'
    // Replace stops only — preserve office_notes, updates, completed/closed state.
    const { error: delErr } = await admin
      .from('daily_log_stops')
      .delete()
      .eq('entry_id', entryId)
    if (delErr) {
      return NextResponse.json({ error: `Failed to clear prior stops: ${delErr.message}` }, { status: 500 })
    }
  } else {
    const { data: newEntry, error: createErr } = await admin
      .from('daily_log_entries')
      .insert({
        company_id: profile.company_id,
        log_date: body.log_date,
        tech_user_id: techUserId,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (createErr || !newEntry) {
      return NextResponse.json({ error: createErr?.message ?? 'Failed to create entry' }, { status: 500 })
    }
    entryId = newEntry.id
    action = 'created'

    // Auto-subscribe creator, mirroring POST /api/hub/daily-log behavior.
    await admin
      .from('daily_log_subscribers')
      .insert({ entry_id: entryId, user_id: user.id })
  }

  // Insert stops in order
  const stopRows = body.stops.map((s, i) => ({
    entry_id: entryId,
    ord: i + 1,
    jobber_visit_id: s.jobber_visit_id ?? null,
    client_name: s.client_name,
    client_phone: s.client_phone ?? null,
    address: s.address,
    lat: s.lat ?? null,
    lng: s.lng ?? null,
    job_title: s.job_title ?? null,
    line_items: Array.isArray(s.line_items) ? s.line_items : [],
    instructions: s.instructions ?? null,
    scheduled_start_at: s.scheduled_start_at ?? null,
    scheduled_end_at: s.scheduled_end_at ?? null,
    duration_minutes: s.duration_minutes ?? null,
  }))

  const { error: stopsErr } = await admin
    .from('daily_log_stops')
    .insert(stopRows)
  if (stopsErr) {
    return NextResponse.json({ error: `Failed to insert stops: ${stopsErr.message}` }, { status: 500 })
  }

  return NextResponse.json({
    entry_id: entryId,
    tech_user_id: techUserId,
    stop_count: stopRows.length,
    action,
  })
}
