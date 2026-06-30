import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getR2Client } from '@/lib/r2'
import { loadCapacityData } from '@/lib/route-capacity-server'
import { computeRouteLoadout, toStoredLoadout, type RouteStopInput } from '@/lib/route-capacity'
import { renderRouteSheetPdf } from '@/lib/route-sheet-pdf'

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
  predicted_drive_minutes?: number | null   // route total — for the Daily Log loadout header (Part D)
  predicted_onsite_minutes?: number | null  // route total — falls back to Σ stop duration_minutes
  tank_overrides?: Record<string, number> | null  // service_product_id → tank_number, from the optimizer (Part B)
  route_html?: string | null     // full self-contained route-sheet HTML (same as Daily Log v1) — optional
  route_name?: string | null     // filename label, e.g. "Ben Simpson - 2026-05-28.html"
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

  // Route Capacity Part D — compute the tank loadout snapshot for this route and
  // store it on the entry. Daily Log V2 only displays it (never recomputes).
  // The optimizer's per-route tank overrides (service_product_id → tank_number)
  // are passed through so the saved snapshot keeps the same tank choices the user
  // saw on screen; absent that, each line item falls back to service_products.tank_default.
  const capacity = await loadCapacityData(admin, profile.company_id)
  const loadoutStops: RouteStopInput[] = body.stops.map(s => ({
    id: s.jobber_visit_id ?? s.client_name,
    clientName: s.client_name,
    jobTitle: s.job_title ?? '',
    lineItemNames: Array.isArray(s.line_items) ? s.line_items.map(li => li.name) : [],
  }))
  const tankOverrides = new Map<string, number>(
    body.tank_overrides && typeof body.tank_overrides === 'object'
      ? Object.entries(body.tank_overrides)
          .map(([spId, tn]) => [spId, Number(tn)] as [string, number])
          .filter(([, tn]) => Number.isFinite(tn))
      : [],
  )
  const computed = computeRouteLoadout(loadoutStops, {
    tanks: capacity.tanks, serviceProducts: capacity.serviceProducts, products: capacity.products,
  }, tankOverrides, body.log_date)
  const onsiteFromStops = body.stops.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0)
  const routeLoadout = toStoredLoadout(computed, {
    predictedDriveMinutes: typeof body.predicted_drive_minutes === 'number' ? body.predicted_drive_minutes : null,
    predictedOnsiteMinutes: typeof body.predicted_onsite_minutes === 'number' ? body.predicted_onsite_minutes : (onsiteFromStops || null),
    computedAt: new Date().toISOString(),
  })

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
    // Refresh the loadout snapshot for the new stop set.
    await admin
      .from('daily_log_entries')
      .update({ route_loadout: routeLoadout })
      .eq('id', entryId)
  } else {
    const { data: newEntry, error: createErr } = await admin
      .from('daily_log_entries')
      .insert({
        company_id: profile.company_id,
        log_date: body.log_date,
        tech_user_id: techUserId,
        created_by: user.id,
        route_loadout: routeLoadout,
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

  // Attach the printable route sheet. We render the self-contained route-sheet
  // HTML to a real PDF server-side (test-findings #7) and store THAT, so DL v2
  // gets an actual downloadable PDF (opened in-app via pdf.js) rather than an
  // HTML preview the tech has to print. Best-effort and last: a route-sheet
  // failure must not lose the stops we already saved. If PDF rendering is
  // unavailable we fall back to storing the HTML so a (printable) sheet still
  // attaches. Skipped silently if no HTML was sent or R2 isn't configured.
  if (
    body.route_html && typeof body.route_html === 'string' &&
    process.env.CF_R2_ACCESS_KEY_ID && process.env.CF_R2_BUCKET_NAME
  ) {
    const baseName = (body.route_name && typeof body.route_name === 'string')
      ? body.route_name.replace(/\.html?$/i, '')
      : `${exactMatches[0].display_name} - ${body.log_date}`
    try {
      const r2 = getR2Client()
      const pdf = await renderRouteSheetPdf(body.route_html)
      const ts = Date.now()
      if (pdf) {
        const routeName = `${baseName}.pdf`
        const r2Key = `daily-log/${profile.company_id}/${entryId}/${ts}.pdf`
        await r2.send(new PutObjectCommand({
          Bucket: process.env.CF_R2_BUCKET_NAME!,
          Key: r2Key,
          Body: pdf,
          ContentType: 'application/pdf',
          ContentDisposition: `inline; filename="${encodeURIComponent(routeName)}"`,
        }))
        await admin
          .from('daily_log_entries')
          .update({ route_sheet_url: r2Key, route_sheet_name: routeName })
          .eq('id', entryId)
      } else {
        // PDF render unavailable — fall back to the self-contained HTML sheet
        // (DL v2 still surfaces it, with its built-in Print / Save as PDF button).
        const routeName = `${baseName}.html`
        const r2Key = `daily-log/${profile.company_id}/${entryId}/${ts}.html`
        await r2.send(new PutObjectCommand({
          Bucket: process.env.CF_R2_BUCKET_NAME!,
          Key: r2Key,
          Body: Buffer.from(body.route_html, 'utf-8'),
          ContentType: 'text/html; charset=utf-8',
          ContentDisposition: `inline; filename="${encodeURIComponent(routeName)}"`,
        }))
        await admin
          .from('daily_log_entries')
          .update({ route_sheet_url: r2Key, route_sheet_name: routeName })
          .eq('id', entryId)
      }
    } catch {
      // Route sheet attach failed — stops are already saved; leave route_sheet_url as-is.
    }
  }

  return NextResponse.json({
    entry_id: entryId,
    tech_user_id: techUserId,
    stop_count: stopRows.length,
    action,
  })
}
