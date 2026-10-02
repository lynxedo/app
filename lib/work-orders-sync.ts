import { createAdminClient } from '@/lib/supabase/admin'
import { geocodeAddresses } from '@/lib/geocode'
import { loadCapacityData } from '@/lib/route-capacity-server'
import { computeRouteLoadout, toStoredLoadout, type RouteStopInput, type StoredRouteLoadout } from '@/lib/route-capacity'
import { resolveJobberUserId } from '@/lib/jobber'

// ── Work Orders fed from Jobber (PRD §6 Phase 1.5, Oct 2 2026) ────────────────
//
// Ben: "wonder if we can do the work orders automatically based on what is in
// Jobber. The route optimizer would be a way to change it. It changes it in
// Jobber so that would update work orders as well."
//
// So: the Jobber schedule IS a tech's Work Order list. For every day in the
// horizon, every Jobber visit assigned to a tech becomes a stop under that
// tech's Daily Log v2 entry, in start-time order, built entirely from the
// Jobber mirror (visits / jobs / clients / properties / line_items — no Jobber
// API call). The Route Optimizer stays the way the office *changes* a day: its
// Send-with-Times writes to Jobber, the webhook refreshes the mirror, and the
// feed follows. Its Send-to-Daily-Log still works and now MERGES (see
// upsertStopsForEntry) instead of deleting and re-inserting the day.
//
// Rules that hold here:
//  • A stop is matched on its Jobber visit id — the one thing that survives a
//    reschedule, a reassignment, or a re-send. Rows are updated in place, or
//    MOVED to the right tech/day, never recreated.
//  • Nothing a tech did is ever thrown away. A visit that leaves the day in
//    Jobber deletes its stop only when the stop is untouched; otherwise the stop
//    is flagged `removed_from_jobber_at` and sinks to the bottom of the list.
//  • Only Jobber VISITS are managed. Tasks and assessments reach the list through
//    the Route Optimizer only (they have no mirror yet) and are never pruned here.
//  • A Jobber completion marks a still-pending Hub stop complete (the tech used
//    the Jobber app during the transition). Hub never un-completes on Jobber's
//    say-so, and this path never calls Jobber back.
//  • Tech mapping: hub_users.jobber_user_id (Admin → People) first, else the
//    first-name match the optimizer's Send to Daily Log has always used. A visit
//    whose tech maps to nobody is reported, not guessed.

type Admin = ReturnType<typeof createAdminClient>

/** Heroes' account timezone; the mirror's `scheduled_date` is already this local date. */
const COMPANY_TZ = 'America/Chicago'
/** Today + this many further days are kept in step by the sweep. */
export const WORK_ORDER_HORIZON_DAYS = 8

export type StopLineItem = { name: string; qty: number; unitPrice: number; totalPrice: number }

export type StopInput = {
  jobber_visit_id: string | null
  client_name: string
  client_phone: string | null
  address: string
  lat: number | null
  lng: number | null
  job_title: string | null
  line_items: StopLineItem[]
  instructions: string | null
  scheduled_start_at: string | null
  scheduled_end_at: string | null
  duration_minutes: number | null
  jobber_job_id?: string | null
  jobber_client_id?: string | null
  contact_id?: string | null
  /** Jobber already shows this visit complete → a still-pending Hub stop follows it. */
  jobber_completed_at?: string | null
}

export type UpsertStopsResult = {
  inserted: number; updated: number; moved: number; deleted: number; flagged: number
  /** Something that changes the loadout happened (stop set or line items). */
  changed: boolean
}

export type SyncDayResult = {
  date: string
  visits: number
  techs: number
  entriesCreated: number
  inserted: number; updated: number; moved: number; deleted: number; flagged: number
  /** Jobber users with visits that day that map to no Hub person (deduped names). */
  unmappedTechs: string[]
  /** Visits assigned to nobody in Jobber. */
  unassigned: number
  /** No connected Jobber account → a new day could not be created (existing ones still updated). */
  noCreator: boolean
}

// ── Dates ────────────────────────────────────────────────────────────────────

export function todayInCompanyTz(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: COMPANY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Decode a Jobber gid (base64 of "gid://Jobber/Visit/123") and say whether it names a Visit. */
export function isJobberVisitGid(id: string | null | undefined): boolean {
  if (!id) return false
  try { return Buffer.from(id, 'base64').toString('utf8').includes('/Visit/') } catch { return false }
}

// ── Stop upsert (shared with the Route Optimizer's Send to Daily Log) ────────

type ExistingStop = {
  id: string
  entry_id: string
  ord: number
  jobber_visit_id: string | null
  status: string
  arrived_at: string | null
  completed_at: string | null
  notes: string | null
  on_my_way_sent_at: string | null
  pesticide_tech_notes: string | null
  pesticide_record_id: string | null
  office_reviewed_at: string | null
  scheduled_start_at: string | null
  line_items: unknown
  address: string
  lat: number | null
  lng: number | null
  instructions: string | null
  duration_minutes: number | null
  removed_from_jobber_at: string | null
}

const EXISTING_COLS =
  'id, entry_id, ord, jobber_visit_id, status, arrived_at, completed_at, notes, on_my_way_sent_at, ' +
  'pesticide_tech_notes, pesticide_record_id, office_reviewed_at, scheduled_start_at, line_items, address, lat, lng, ' +
  'instructions, duration_minutes, removed_from_jobber_at'

function hasTechState(s: ExistingStop, inspected: Set<string>): boolean {
  return s.status !== 'pending'
    || !!s.arrived_at || !!s.notes || !!s.on_my_way_sent_at || !!s.pesticide_tech_notes
    || !!s.pesticide_record_id || !!s.office_reviewed_at || inspected.has(s.id)
}

function lineItemsKey(li: unknown): string {
  try { return JSON.stringify(li ?? []) } catch { return '' }
}

/**
 * Write a set of stops onto one entry, matching on the Jobber visit id.
 *
 *  - a stop already on this entry is UPDATED (facts refreshed, tech state kept)
 *  - a stop for the same visit under another entry of this company is MOVED here
 *  - anything else is INSERTED
 *  - with `pruneMissingVisits`, a Visit stop on this entry that is not in `stops`
 *    is deleted when untouched, else flagged `removed_from_jobber_at`; a visit
 *    listed in `keepVisitIds` (still on this day in Jobber, under a tech we
 *    cannot map or who is synced separately) is left alone instead.
 *  - finally every stop on the entry is re-numbered by scheduled time (nulls
 *    last, flagged stops at the very end).
 */
export async function upsertStopsForEntry(admin: Admin, p: {
  companyId: string
  entryId: string
  stops: StopInput[]
  source: 'route' | 'jobber'
  pruneMissingVisits: boolean
  keepVisitIds?: Set<string>
}): Promise<UpsertStopsResult> {
  const now = new Date().toISOString()
  const res: UpsertStopsResult = { inserted: 0, updated: 0, moved: 0, deleted: 0, flagged: 0, changed: false }

  const { data: existingRaw } = await admin.from('daily_log_stops').select(EXISTING_COLS).eq('entry_id', p.entryId)
  const existing = (existingRaw ?? []) as unknown as ExistingStop[]
  const hereByVisit = new Map<string, ExistingStop>()
  for (const s of existing) if (s.jobber_visit_id && !hereByVisit.has(s.jobber_visit_id)) hereByVisit.set(s.jobber_visit_id, s)

  // The same visit parked under another entry of this company → move it here.
  const incomingIds = p.stops.map(s => s.jobber_visit_id).filter((x): x is string => !!x)
  const elsewhere = new Map<string, ExistingStop>()
  if (incomingIds.length > 0) {
    const { data } = await admin
      .from('daily_log_stops')
      .select(`${EXISTING_COLS}, entry:daily_log_entries!entry_id(company_id)`)
      .in('jobber_visit_id', incomingIds)
      .neq('entry_id', p.entryId)
    for (const row of (data ?? []) as unknown as (ExistingStop & { entry: { company_id: string } | null })[]) {
      if (row.entry?.company_id === p.companyId && row.jobber_visit_id && !elsewhere.has(row.jobber_visit_id)) {
        elsewhere.set(row.jobber_visit_id, row)
      }
    }
  }

  // Which stops on this entry carry an inspection (tech state the FK would null out on delete).
  const inspected = new Set<string>()
  if (existing.length > 0) {
    const { data } = await admin
      .from('irrigation_inspections')
      .select('stop_id')
      .in('stop_id', existing.map(s => s.id))
    for (const r of data ?? []) if (r.stop_id) inspected.add(r.stop_id as string)
  }

  type Final = { id: string; ord: number; startAt: string | null; flagged: boolean; incomingIndex: number }
  const finals: Final[] = []
  const seenVisit = new Set<string>()

  for (let i = 0; i < p.stops.length; i++) {
    const s = p.stops[i]
    const vid = s.jobber_visit_id
    const here = vid ? hereByVisit.get(vid) : undefined
    const away = !here && vid ? elsewhere.get(vid) : undefined
    const target = here ?? away
    if (vid) seenVisit.add(vid)

    // Facts refreshed every time; a null from the mirror never erases a value the
    // optimizer sent (coords, instructions, duration).
    const facts: Record<string, unknown> = {
      client_name: s.client_name,
      client_phone: s.client_phone ?? null,
      address: s.address,
      job_title: s.job_title ?? null,
      line_items: s.line_items,
      scheduled_start_at: s.scheduled_start_at ?? null,
      scheduled_end_at: s.scheduled_end_at ?? null,
      removed_from_jobber_at: null,
      updated_at: now,
    }
    if (s.lat != null && s.lng != null) { facts.lat = s.lat; facts.lng = s.lng }
    if (s.instructions != null) facts.instructions = s.instructions
    if (s.duration_minutes != null) facts.duration_minutes = s.duration_minutes
    if (s.jobber_job_id) facts.jobber_job_id = s.jobber_job_id
    if (s.jobber_client_id) facts.jobber_client_id = s.jobber_client_id
    if (s.contact_id) facts.contact_id = s.contact_id
    if (p.source === 'jobber') facts.jobber_synced_at = now

    if (target) {
      // Jobber says complete, Hub still pending → follow (never the other way).
      if (s.jobber_completed_at && target.status === 'pending') {
        facts.status = 'complete'
        facts.completed_at = s.jobber_completed_at
        res.changed = true
      }
      if (away) { facts.entry_id = p.entryId; res.moved += 1; res.changed = true } else { res.updated += 1 }
      if (lineItemsKey(target.line_items) !== lineItemsKey(s.line_items) || target.removed_from_jobber_at) res.changed = true
      const { error } = await admin.from('daily_log_stops').update(facts).eq('id', target.id)
      if (error) throw new Error(`stop update ${target.id}: ${error.message}`)
      finals.push({ id: target.id, ord: target.ord, startAt: s.scheduled_start_at ?? null, flagged: false, incomingIndex: i })
    } else {
      // (entry_id, ord) is UNIQUE — park new rows in a high, distinct range and let
      // the re-numbering below settle them.
      const tempOrd = 10000 + i
      const row: Record<string, unknown> = {
        ...facts,
        entry_id: p.entryId,
        ord: tempOrd,
        jobber_visit_id: vid,
        lat: s.lat ?? null,
        lng: s.lng ?? null,
        instructions: s.instructions ?? null,
        duration_minutes: s.duration_minutes ?? null,
        jobber_job_id: s.jobber_job_id ?? null,
        jobber_client_id: s.jobber_client_id ?? null,
        contact_id: s.contact_id ?? null,
        source: p.source,
        status: s.jobber_completed_at ? 'complete' : 'pending',
        completed_at: s.jobber_completed_at ?? null,
      }
      const { data: created, error } = await admin.from('daily_log_stops').insert(row).select('id').single()
      if (error || !created) throw new Error(`stop insert: ${error?.message ?? 'no row'}`)
      res.inserted += 1
      res.changed = true
      finals.push({ id: created.id as string, ord: tempOrd, startAt: s.scheduled_start_at ?? null, flagged: false, incomingIndex: i })
    }
  }

  // Survivors: stops on this entry that were not in the incoming set.
  for (const s of existing) {
    if (s.jobber_visit_id && seenVisit.has(s.jobber_visit_id)) continue
    const manageable = p.pruneMissingVisits && isJobberVisitGid(s.jobber_visit_id)
      && !(s.jobber_visit_id && p.keepVisitIds?.has(s.jobber_visit_id))
    if (manageable) {
      if (hasTechState(s, inspected)) {
        if (!s.removed_from_jobber_at) {
          const { error } = await admin.from('daily_log_stops').update({ removed_from_jobber_at: now, updated_at: now }).eq('id', s.id)
          if (error) throw new Error(`stop flag ${s.id}: ${error.message}`)
          res.flagged += 1
          res.changed = true
        }
        finals.push({ id: s.id, ord: s.ord, startAt: s.scheduled_start_at, flagged: true, incomingIndex: Number.MAX_SAFE_INTEGER })
      } else {
        const { error } = await admin.from('daily_log_stops').delete().eq('id', s.id)
        if (error) throw new Error(`stop delete ${s.id}: ${error.message}`)
        res.deleted += 1
        res.changed = true
      }
    } else {
      finals.push({ id: s.id, ord: s.ord, startAt: s.scheduled_start_at, flagged: !!s.removed_from_jobber_at, incomingIndex: Number.MAX_SAFE_INTEGER })
    }
  }

  // Re-number: by time (nulls last), then incoming order, then the old ord;
  // flagged stops sink to the bottom.
  finals.sort((a, b) => {
    if (a.flagged !== b.flagged) return a.flagged ? 1 : -1
    if (a.startAt && b.startAt && a.startAt !== b.startAt) return a.startAt.localeCompare(b.startAt)
    if (!!a.startAt !== !!b.startAt) return a.startAt ? -1 : 1
    if (a.incomingIndex !== b.incomingIndex) return a.incomingIndex - b.incomingIndex
    return a.ord - b.ord
  })
  // Two phases: (entry_id, ord) is UNIQUE, so stop A cannot take ord 2 while
  // stop B still holds it. Park every stop that moves in a high range first.
  const moving = finals.map((f, i) => ({ f, want: i + 1 })).filter(x => x.f.ord !== x.want)
  for (let i = 0; i < moving.length; i++) {
    const { error } = await admin.from('daily_log_stops').update({ ord: 20000 + i }).eq('id', moving[i].f.id)
    if (error) throw new Error(`stop ord park ${moving[i].f.id}: ${error.message}`)
  }
  for (const { f, want } of moving) {
    const { error } = await admin.from('daily_log_stops').update({ ord: want }).eq('id', f.id)
    if (error) throw new Error(`stop ord ${f.id}: ${error.message}`)
  }

  return res
}

// ── Tech mapping ─────────────────────────────────────────────────────────────

type TechMap = {
  /** Jobber user gid → Hub user id */
  byJobber: Map<string, string>
  jobberName: (gid: string) => string
}

async function loadTechMap(admin: Admin, companyId: string): Promise<TechMap> {
  const [{ data: hubUsers }, { data: jUsers }] = await Promise.all([
    admin.from('hub_users').select('id, display_name, jobber_user_id').eq('company_id', companyId).eq('is_bot', false),
    admin.from('jobber_users').select('external_id, name').eq('company_id', companyId),
  ])
  const byJobber = new Map<string, string>()
  const linkedHub = new Set<string>()
  for (const h of hubUsers ?? []) {
    if (h.jobber_user_id) { byJobber.set(h.jobber_user_id as string, h.id as string); linkedHub.add(h.id as string) }
  }
  // Fallback — the optimizer's rule: Jobber "Josh Allen" ↔ Hub "Josh", unique first token.
  const firstTok = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  const hubByFirst = new Map<string, string[]>()
  for (const h of hubUsers ?? []) {
    if (linkedHub.has(h.id as string)) continue
    const k = firstTok(h.display_name as string)
    if (!k) continue
    const arr = hubByFirst.get(k) ?? []
    arr.push(h.id as string)
    hubByFirst.set(k, arr)
  }
  const names = new Map<string, string>()
  for (const j of jUsers ?? []) {
    names.set(j.external_id as string, (j.name as string) || (j.external_id as string))
    if (byJobber.has(j.external_id as string)) continue
    const cands = hubByFirst.get(firstTok(j.name as string))
    if (cands && cands.length === 1) byJobber.set(j.external_id as string, cands[0])
  }
  return { byJobber, jobberName: gid => names.get(gid) ?? gid }
}

// ── Building stops from the mirror ───────────────────────────────────────────

type VisitRow = {
  external_id: string
  title: string | null
  start_at: string | null
  end_at: string | null
  completed_at: string | null
  visit_status: string | null
  tech_external_user_ids: string[] | null
  client_external_id: string | null
  job_external_id: string | null
}

type VisitDetails = {
  clients: Map<string, { name: string | null; phone: string | null; contactId: string | null }>
  jobs: Map<string, { propertyExternalId: string | null; instructions: string | null }>
  properties: Map<string, { address: string }>
  lineItems: Map<string, StopLineItem[]>
  defaultMinutes: number | null
}

function uniq<T>(xs: (T | null | undefined)[]): T[] {
  return [...new Set(xs.filter((x): x is T => x != null))]
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

async function loadVisitDetails(admin: Admin, companyId: string, visits: VisitRow[]): Promise<VisitDetails> {
  const clientIds = uniq(visits.map(v => v.client_external_id))
  const jobIds = uniq(visits.map(v => v.job_external_id))
  const visitIds = visits.map(v => v.external_id)

  const clients = new Map<string, { name: string | null; phone: string | null; contactId: string | null }>()
  for (const ids of chunk(clientIds, 150)) {
    const { data } = await admin.from('clients').select('external_id, name, phone').eq('company_id', companyId).in('external_id', ids)
    for (const c of data ?? []) clients.set(c.external_id as string, { name: (c.name as string) ?? null, phone: (c.phone as string) ?? null, contactId: null })
    const { data: contacts } = await admin
      .from('txt_contacts').select('id, jobber_client_id, created_at')
      .eq('company_id', companyId).in('jobber_client_id', ids).is('deleted_at', null)
      .order('created_at', { ascending: true })
    for (const t of contacts ?? []) {
      const c = clients.get(t.jobber_client_id as string)
      if (c && !c.contactId) c.contactId = t.id as string
    }
  }

  const jobs = new Map<string, { propertyExternalId: string | null; instructions: string | null }>()
  for (const ids of chunk(jobIds, 150)) {
    const { data } = await admin.from('jobs').select('external_id, property_external_id, instructions').eq('company_id', companyId).in('external_id', ids)
    for (const j of data ?? []) jobs.set(j.external_id as string, { propertyExternalId: (j.property_external_id as string) ?? null, instructions: (j.instructions as string) ?? null })
  }

  const propIds = uniq([...jobs.values()].map(j => j.propertyExternalId))
  const properties = new Map<string, { address: string }>()
  for (const ids of chunk(propIds, 150)) {
    const { data } = await admin.from('properties').select('external_id, address_line1, address_line2, city, state, zip').eq('company_id', companyId).in('external_id', ids)
    for (const p of data ?? []) {
      const street = [p.address_line1, p.address_line2].filter(Boolean).join(' ').trim()
      const tail = [p.city, [p.state, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
      properties.set(p.external_id as string, { address: [street, tail].filter(Boolean).join(', ') })
    }
  }

  const lineItems = new Map<string, StopLineItem[]>()
  for (const ids of chunk(visitIds, 150)) {
    const { data } = await admin
      .from('line_items').select('parent_external_id, name, quantity, unit_price, total')
      .eq('company_id', companyId).eq('parent_type', 'visit').in('parent_external_id', ids).is('deleted_at', null)
      .order('created_at', { ascending: true })
    for (const li of data ?? []) {
      const arr = lineItems.get(li.parent_external_id as string) ?? []
      arr.push({
        name: (li.name as string) ?? '',
        qty: Number(li.quantity ?? 1),
        unitPrice: Number(li.unit_price ?? 0),
        totalPrice: Number(li.total ?? 0),
      })
      lineItems.set(li.parent_external_id as string, arr)
    }
  }

  const { data: settings } = await admin.from('company_routing_settings').select('default_service_minutes').eq('company_id', companyId).maybeSingle()
  const dm = settings?.default_service_minutes
  return { clients, jobs, properties, lineItems, defaultMinutes: typeof dm === 'number' && dm > 0 ? dm : null }
}

function isVisitComplete(v: VisitRow): boolean {
  return !!v.completed_at || (v.visit_status ?? '').toUpperCase() === 'COMPLETED'
}

function buildStopInput(v: VisitRow, d: VisitDetails): StopInput {
  const client = v.client_external_id ? d.clients.get(v.client_external_id) : undefined
  const job = v.job_external_id ? d.jobs.get(v.job_external_id) : undefined
  const prop = job?.propertyExternalId ? d.properties.get(job.propertyExternalId) : undefined
  let minutes: number | null = null
  if (v.start_at && v.end_at) {
    const m = Math.round((Date.parse(v.end_at) - Date.parse(v.start_at)) / 60000)
    if (m > 0 && m < 24 * 60) minutes = m
  }
  return {
    jobber_visit_id: v.external_id,
    client_name: client?.name?.trim() || v.title || 'Unknown customer',
    client_phone: client?.phone ?? null,
    address: prop?.address ?? '',
    lat: null,
    lng: null,
    job_title: v.title ?? null,
    line_items: d.lineItems.get(v.external_id) ?? [],
    instructions: job?.instructions ?? null,
    scheduled_start_at: v.start_at ?? null,
    scheduled_end_at: v.end_at ?? null,
    duration_minutes: minutes ?? d.defaultMinutes,
    jobber_job_id: v.job_external_id ?? null,
    jobber_client_id: v.client_external_id ?? null,
    contact_id: client?.contactId ?? null,
    jobber_completed_at: isVisitComplete(v) ? (v.completed_at ?? v.end_at ?? v.start_at ?? null) : null,
  }
}

// ── Loadout (tank header) ────────────────────────────────────────────────────

async function recomputeLoadout(admin: Admin, companyId: string, entryId: string, date: string, previous: StoredRouteLoadout | null) {
  const { data: stops } = await admin
    .from('daily_log_stops').select('id, jobber_visit_id, client_name, job_title, line_items, duration_minutes, removed_from_jobber_at')
    .eq('entry_id', entryId).is('removed_from_jobber_at', null)
  const inputs: RouteStopInput[] = (stops ?? []).map(s => ({
    id: (s.jobber_visit_id as string) ?? (s.id as string),
    clientName: (s.client_name as string) ?? '',
    jobTitle: (s.job_title as string) ?? '',
    lineItemNames: Array.isArray(s.line_items) ? (s.line_items as { name?: string }[]).map(li => li?.name ?? '').filter(Boolean) : [],
  }))
  const capacity = await loadCapacityData(admin, companyId)
  const computed = computeRouteLoadout(inputs, { tanks: capacity.tanks, serviceProducts: capacity.serviceProducts, products: capacity.products }, new Map(), date)
  const onsite = (stops ?? []).reduce((sum, s) => sum + (Number(s.duration_minutes) || 0), 0)
  const stored = toStoredLoadout(computed, {
    // The optimizer's drive estimate is the one thing we can't recompute here; keep it.
    predictedDriveMinutes: previous?.predicted_drive_minutes ?? null,
    predictedOnsiteMinutes: onsite || null,
    computedAt: new Date().toISOString(),
  })
  await admin.from('daily_log_entries').update({ route_loadout: stored }).eq('id', entryId)
}

// ── The day sync ─────────────────────────────────────────────────────────────

export async function syncWorkOrdersForDay(companyId: string, date: string): Promise<SyncDayResult> {
  if (!DATE_RE.test(date)) throw new Error(`bad date ${date}`)
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const result: SyncDayResult = {
    date, visits: 0, techs: 0, entriesCreated: 0, inserted: 0, updated: 0, moved: 0, deleted: 0, flagged: 0,
    unmappedTechs: [], unassigned: 0, noCreator: false,
  }

  const { data: visitsRaw, error: vErr } = await admin
    .from('visits')
    .select('external_id, title, start_at, end_at, completed_at, visit_status, tech_external_user_ids, client_external_id, job_external_id')
    .eq('company_id', companyId).eq('scheduled_date', date).is('deleted_at', null)
  if (vErr) throw new Error(`visits read: ${vErr.message}`)
  const visits = (visitsRaw ?? []) as VisitRow[]
  result.visits = visits.length

  const techMap = await loadTechMap(admin, companyId)
  const byTech = new Map<string, VisitRow[]>()
  const secondaries = new Map<string, Set<string>>()
  const unmapped = new Set<string>()
  const dayVisitIds = new Set(visits.map(v => v.external_id))
  for (const v of visits) {
    const ids = (v.tech_external_user_ids ?? []).filter(Boolean)
    if (ids.length === 0) { result.unassigned += 1; continue }
    const owner = techMap.byJobber.get(ids[0])
    if (!owner) { unmapped.add(techMap.jobberName(ids[0])); continue }
    const arr = byTech.get(owner) ?? []
    arr.push(v)
    byTech.set(owner, arr)
    for (const extra of ids.slice(1)) {
      const h = techMap.byJobber.get(extra)
      if (h && h !== owner) {
        const set = secondaries.get(owner) ?? new Set<string>()
        set.add(h)
        secondaries.set(owner, set)
      }
    }
  }
  result.unmappedTechs = [...unmapped].sort()
  result.techs = byTech.size

  const details = await loadVisitDetails(admin, companyId, visits)
  const creator = await resolveJobberUserId(companyId, undefined, { alertIfBroken: false })

  // Every entry already on this day (office-made or fed) takes part, so a visit
  // that left a tech's day in Jobber is pruned from the old entry too.
  const { data: entriesRaw } = await admin
    .from('daily_log_entries')
    .select('id, tech_user_id, route_loadout, secondary_tech_user_ids, synced_from_jobber_at')
    .eq('company_id', companyId).eq('log_date', date).is('deleted_at', null)
  type EntryRow = { id: string; tech_user_id: string; route_loadout: StoredRouteLoadout | null; secondary_tech_user_ids: string[] | null; synced_from_jobber_at: string | null }
  const entries = new Map<string, EntryRow>()
  for (const e of (entriesRaw ?? []) as EntryRow[]) entries.set(e.tech_user_id, e)

  const techIds = new Set<string>([...byTech.keys(), ...entries.keys()])
  for (const techId of techIds) {
    const tvs = (byTech.get(techId) ?? []).slice().sort((a, b) => {
      if (a.start_at && b.start_at && a.start_at !== b.start_at) return a.start_at.localeCompare(b.start_at)
      if (!!a.start_at !== !!b.start_at) return a.start_at ? -1 : 1
      return (a.title ?? '').localeCompare(b.title ?? '')
    })
    let entry = entries.get(techId) ?? null
    if (!entry) {
      if (tvs.length === 0) continue
      if (!creator) { result.noCreator = true; continue }
      const { data: created, error } = await admin
        .from('daily_log_entries')
        .insert({ company_id: companyId, log_date: date, tech_user_id: techId, created_by: creator, synced_from_jobber_at: now })
        .select('id, tech_user_id, route_loadout, secondary_tech_user_ids, synced_from_jobber_at')
        .single()
      if (error || !created) throw new Error(`entry create for ${techId}: ${error?.message ?? 'no row'}`)
      entry = created as EntryRow
      result.entriesCreated += 1
    }

    const stops = tvs.map(v => buildStopInput(v, details))
    // Coordinates for the map pins — persistent cache, so a known address costs a DB read.
    const addrs = stops.map(s => s.address)
    if (addrs.some(Boolean)) {
      try {
        const coords = await geocodeAddresses(addrs.map(a => a || '—'))
        stops.forEach((s, i) => { const c = coords[i]; if (s.address && c) { s.lat = c.lat; s.lng = c.lng } })
      } catch (e) {
        console.warn('[work-orders] geocode failed (stops keep no coords):', e instanceof Error ? e.message : String(e))
      }
    }

    const up = await upsertStopsForEntry(admin, {
      companyId, entryId: entry.id, stops, source: 'jobber', pruneMissingVisits: true, keepVisitIds: dayVisitIds,
    })
    result.inserted += up.inserted; result.updated += up.updated; result.moved += up.moved
    result.deleted += up.deleted; result.flagged += up.flagged

    const entryPatch: Record<string, unknown> = { synced_from_jobber_at: now }
    const extra = secondaries.get(techId)
    if (extra && extra.size > 0) {
      const merged = new Set<string>([...(entry.secondary_tech_user_ids ?? []), ...extra])
      merged.delete(techId)
      if (merged.size !== (entry.secondary_tech_user_ids ?? []).length) entryPatch.secondary_tech_user_ids = [...merged]
    }
    await admin.from('daily_log_entries').update(entryPatch).eq('id', entry.id)

    if (up.changed || !entry.route_loadout) {
      try { await recomputeLoadout(admin, companyId, entry.id, date, entry.route_loadout) }
      catch (e) { console.warn('[work-orders] loadout recompute failed:', e instanceof Error ? e.message : String(e)) }
    }
  }

  return result
}

export async function syncWorkOrdersForRange(companyId: string, fromDate: string, days: number): Promise<SyncDayResult[]> {
  const out: SyncDayResult[] = []
  const n = Math.max(1, Math.min(31, Math.floor(days)))
  for (let i = 0; i < n; i++) {
    const date = addDays(fromDate, i)
    try {
      out.push(await syncWorkOrdersForDay(companyId, date))
    } catch (e) {
      console.error(`[work-orders] sync ${date} failed:`, e instanceof Error ? e.message : String(e))
      out.push({ date, visits: 0, techs: 0, entriesCreated: 0, inserted: 0, updated: 0, moved: 0, deleted: 0, flagged: 0, unmappedTechs: [], unassigned: 0, noCreator: false })
    }
  }
  return out
}

/** Days a late or far-future webhook may touch (never re-write distant history). */
function withinReach(date: string): boolean {
  const today = todayInCompanyTz()
  return date >= addDays(today, -1) && date <= addDays(today, 14)
}

/**
 * Webhook hook: a visit was created / rescheduled / reassigned / completed /
 * destroyed. Re-sync the day it is on now AND any day a stop for it already sits
 * on, so a move leaves the old day clean. Best-effort — callers never fail on it.
 */
export async function syncWorkOrdersForVisit(companyId: string, visitExternalId: string): Promise<void> {
  const admin = createAdminClient()
  const dates = new Set<string>()
  const { data: v } = await admin.from('visits').select('scheduled_date').eq('company_id', companyId).eq('external_id', visitExternalId).maybeSingle()
  if (v?.scheduled_date) dates.add(v.scheduled_date as string)
  const { data: stops } = await admin
    .from('daily_log_stops').select('entry:daily_log_entries!entry_id(company_id, log_date)')
    .eq('jobber_visit_id', visitExternalId)
  for (const s of (stops ?? []) as unknown as { entry: { company_id: string; log_date: string } | null }[]) {
    if (s.entry?.company_id === companyId && s.entry.log_date) dates.add(s.entry.log_date)
  }
  for (const d of dates) if (withinReach(d)) await syncWorkOrdersForDay(companyId, d)
}

/** Webhook hook: a job changed (title, instructions, line items) — refresh the days its visits are on. */
export async function syncWorkOrdersForJob(companyId: string, jobExternalId: string): Promise<void> {
  const admin = createAdminClient()
  const today = todayInCompanyTz()
  const { data } = await admin
    .from('visits').select('scheduled_date')
    .eq('company_id', companyId).eq('job_external_id', jobExternalId).is('deleted_at', null)
    .gte('scheduled_date', today).lte('scheduled_date', addDays(today, WORK_ORDER_HORIZON_DAYS - 1))
  const dates = new Set<string>((data ?? []).map(r => r.scheduled_date as string).filter(Boolean))
  for (const d of dates) await syncWorkOrdersForDay(companyId, d)
}
