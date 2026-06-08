// One-way Monday -> Lynxedo Tracker mirror.
//
// Keeps the three Tracker boards (recurring_services, route_capacity, leads) in
// step with their Monday source boards while Monday is still the system of
// record (pre-cutover). Pure mirror: upsert keyed on `monday_item_id`, so it is
// structurally immune to duplicates from Monday's cross-board automations —
// every Monday item (hand-made or automation-created, incl. "(copy)") has one
// stable id => one Lynxedo row.
//
// IMPORTANT: While this mirror runs, the Lynxedo-native Lead->Recurring
// replication (lib/recurring-sync.ts) MUST stay OFF. Running both creates
// duplicate recurring_services rows (one keyed on monday_item_id, one on
// lead_id) that won't dedupe. At full cutover: mirror OFF, native sync ON.
//
// Deletes are HARD (Ben's call) but guarded: a board that returns 0 rows — or a
// pull smaller than half the existing mirror — aborts deletes for that board so
// a transient Monday API hiccup can never wipe a table.
//
// `leads` had no monday_item_id originally, so the first run re-keys existing
// leads to their Monday item via a full-tuple positional match (pairs 1:1 even
// when several leads share name+phone). Lead Comments are NOT re-synced as notes
// (one-time import; re-syncing would duplicate them).

import type { SupabaseClient } from '@supabase/supabase-js'

const HEROES_COMPANY_ID = '00000000-0000-0000-0000-000000000002'
const MONDAY_API = 'https://api.monday.com/v2'
const PAGE = 500
// Abort a board's hard-delete if the pull looks suspiciously small.
const MIN_PULL_FRACTION = 0.5

export const BOARD_IDS = {
  recurring: '18188676554',
  route: '18408768408',
  leads: '18392764674',
} as const

export type BoardKey = keyof typeof BOARD_IDS

type MondayItem = {
  id: string
  name: string | null
  group?: { title: string | null } | null
  column_values: { id: string; text: string | null }[]
}

export type BoardReport = {
  board: BoardKey
  pulled: number
  upserted: number
  deleted: number
  deleteSkippedReason?: string
  // leads-only
  rekeyMatched?: number
  newInserts?: number
  unmatchedExistingLeads?: number
}

export type SyncReport = {
  dryRun: boolean
  boards: BoardReport[]
  errors: string[]
}

// ---- Monday GraphQL ---------------------------------------------------------

async function mondayGraphQL(query: string): Promise<any> {
  const token = process.env.MONDAY_API_TOKEN
  if (!token) throw new Error('MONDAY_API_TOKEN is not configured')
  const res = await fetch(MONDAY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'API-Version': '2024-10',
    },
    body: JSON.stringify({ query }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json) throw new Error(`Monday API HTTP ${res.status}`)
  if (json.errors) throw new Error('Monday API error: ' + JSON.stringify(json.errors).slice(0, 400))
  return json.data
}

const ITEM_FIELDS = 'id name group { title } column_values { id text }'

async function fetchBoardItems(boardId: string): Promise<MondayItem[]> {
  const first = await mondayGraphQL(
    `query { boards(ids: [${boardId}]) { items_page(limit: ${PAGE}) { cursor items { ${ITEM_FIELDS} } } } }`
  )
  const page = first?.boards?.[0]?.items_page
  if (!page) throw new Error(`Board ${boardId}: no items_page in response`)
  let items: MondayItem[] = page.items ?? []
  let cursor: string | null = page.cursor
  while (cursor) {
    const next = await mondayGraphQL(
      `query { next_items_page(limit: ${PAGE}, cursor: "${cursor}") { cursor items { ${ITEM_FIELDS} } } }`
    )
    const np = next?.next_items_page
    if (!np) break
    items = items.concat(np.items ?? [])
    cursor = np.cursor
  }
  return items
}

// ---- value helpers (mirror scripts/import-*.py) -----------------------------

function clean(v: string | null | undefined): string | null {
  if (v == null) return null
  const t = v.trim()
  return t === '' ? null : t
}
function toArray(text: string | null | undefined): string[] | null {
  const c = clean(text)
  if (!c) return null
  const arr = c.split(',').map(s => s.trim()).filter(Boolean)
  return arr.length ? arr : null
}
function toNum(text: string | null | undefined): number | null {
  const c = clean(text)
  if (!c) return null
  const n = parseFloat(c.replace(/,/g, ''))
  return Number.isNaN(n) ? null : n
}
function toBool(text: string | null | undefined): boolean {
  const c = clean(text)
  if (!c) return false
  return ['v', 'true', '1', 'checked', 'yes'].includes(c.toLowerCase())
}
function cmap(item: MondayItem): Record<string, string | null> {
  const m: Record<string, string | null> = {}
  for (const cv of item.column_values ?? []) m[cv.id] = cv.text ?? null
  return m
}

// ---- transforms -------------------------------------------------------------

function transformRecurring(item: MondayItem) {
  const c = cmap(item)
  return {
    company_id: HEROES_COMPANY_ID,
    source: 'monday',
    monday_item_id: String(item.id),
    monday_group: item.group?.title ?? null,
    name: clean(item.name),
    phone: clean(c['text_mkp4hekd']),
    email: clean(c['text_mkp42w0x']),
    lead_comments: clean(c['long_text_mkp4p5qf']),
    service: toArray(c['dropdown_Mjj5nJ1I']),
    lead_source: clean(c['dropdown__1']),
    status: clean(c['status__1']),
    lead_creation_date: clean(c['date1']),
    annual_value: toNum(c['numbers']),
    sold_date: clean(c['date9']),
    salesperson: clean(c['color_mkpjhknz']),
    base_program_sold: clean(c['dropdown_mkwr5ny9']),
    auxiliary_services: toArray(c['dropdown_mkwrfsf6']),
    cancelled_status: clean(c['color_mkwrfe52']),
    cancellation_reason: clean(c['dropdown_mkwrp11g']),
    cancel_date: clean(c['date_mkwrmp6c']),
    temp_updated: toBool(c['boolean_mkyrg3ce']),
    temp_prepaid: toBool(c['boolean_mkyrg5r2']),
  }
}

function transformRoute(item: MondayItem) {
  const c = cmap(item)
  return {
    company_id: HEROES_COMPANY_ID,
    source: 'monday',
    monday_item_id: String(item.id),
    monday_group: item.group?.title ?? null,
    name: clean(item.name),
    sync_date: clean(c['date_mm2epmg3']),
    job_title: clean(c['text_mm2e9h3k']),
    client_name: clean(c['text_mm2e37x7']),
    service_street: clean(c['text_mm2ejb49']),
    service_city: clean(c['text_mm2exx8d']),
    service_province: clean(c['text_mm2e8c71']),
    service_zip: clean(c['text_mm2ma0q1']),
    line_items: clean(c['text_mm2edd00']),
    total: toNum(c['numeric_mm2ebvsy']),
    lawn_size: clean(c['text_mm2evevg']),
    size_helper: clean(c['text_mm2esdfj']),
    drive_time: toNum(c['numeric_mm2gm1mw']),
  }
}

const GROUP_STAGE: Record<string, string> = {
  'Leads- Current': 'current',
  'Appointment Set': 'appointment_set',
  'Follow Up - Long Term': 'follow_up_long_term',
  'Closed Won': 'closed_won',
  Upsells: 'upsells',
  'Closed Lost': 'closed_lost',
  'Closed Other': 'closed_other',
  Saves: 'saves',
}

type LeadRow = {
  company_id: string
  monday_item_id: string
  stage: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
  service: string[] | null
  lead_source: string | null
  status: string | null
  lead_creation_date: string | null
  sold_date: string | null
  annual_value: number | null
  salesperson: string | null
  base_program_sold: string | null
  auxiliary_services: string[] | null
}

function transformLead(item: MondayItem): LeadRow {
  const c = cmap(item)
  let first = clean(c['text_mm01h2aw'])
  let last = clean(c['text_mm01ne1y'])
  if (!first && !last) {
    const parts = (clean(item.name) || '').split(/\s+/).filter(Boolean)
    if (parts.length) {
      first = parts[0]
      last = parts.slice(1).join(' ') || null
    }
  }
  return {
    company_id: HEROES_COMPANY_ID,
    monday_item_id: String(item.id),
    stage: GROUP_STAGE[item.group?.title ?? ''] ?? 'current',
    first_name: first,
    last_name: last,
    phone: clean(c['text_mkp4hekd']),
    email: clean(c['text_mkp42w0x']),
    service: toArray(c['dropdown_Mjj5nJ1I']),
    lead_source: clean(c['dropdown__1']),
    status: clean(c['status__1']),
    lead_creation_date: clean(c['date1']),
    sold_date: clean(c['date9']),
    annual_value: toNum(c['numbers']),
    salesperson: clean(c['color_mkpjhknz']),
    base_program_sold: clean(c['dropdown_mkxe4k2k']),
    auxiliary_services: toArray(c['dropdown_mkxe7j80']),
  }
}

// ---- shared upsert / guarded hard-delete ------------------------------------

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

async function upsertRows(admin: SupabaseClient, table: string, rows: any[]) {
  for (const c of chunk(rows, 200)) {
    const { error } = await admin.from(table).upsert(c, { onConflict: 'monday_item_id' })
    if (error) throw new Error(`${table} upsert: ${error.message}`)
  }
}

// Hard-delete mirror rows whose monday_item_id is no longer present in Monday.
// `mirrorFilter` scopes the existing-row read to mirror rows only.
async function guardedDelete(
  admin: SupabaseClient,
  table: string,
  pulledIds: Set<string>,
  mirrorFilter: (q: any) => any,
  report: BoardReport
) {
  if (pulledIds.size === 0) {
    report.deleteSkippedReason = 'pull returned 0 rows — deletes aborted'
    return
  }
  const { data, error } = await mirrorFilter(
    admin.from(table).select('id, monday_item_id').not('monday_item_id', 'is', null)
  )
  if (error) throw new Error(`${table} existing-id read: ${error.message}`)
  const existing = (data ?? []) as { id: string; monday_item_id: string }[]
  const toDelete = existing.filter(r => !pulledIds.has(r.monday_item_id))

  if (existing.length > 0 && pulledIds.size < existing.length * MIN_PULL_FRACTION) {
    report.deleteSkippedReason = `pull (${pulledIds.size}) < 50% of existing mirror rows (${existing.length}) — deletes aborted`
    return
  }
  report.deleted = toDelete.length
  if (report.deleted === 0) return
  for (const c of chunk(toDelete.map(r => r.id), 100)) {
    const { error: delErr } = await admin.from(table).delete().in('id', c)
    if (delErr) throw new Error(`${table} delete: ${delErr.message}`)
  }
}

// ---- leads re-key (full-tuple positional match) -----------------------------

function leadKey(r: {
  first_name: string | null
  last_name: string | null
  phone: string | null
  lead_creation_date: string | null
  sold_date: string | null
  annual_value: number | null
  base_program_sold: string | null
  status: string | null
  salesperson: string | null
}): string {
  const s = (x: string | null) => (x ?? '').trim().toLowerCase()
  const n = (x: number | null) => (x == null ? '' : String(Number(x)))
  return [
    s(r.first_name), s(r.last_name), s(r.phone), s(r.lead_creation_date),
    s(r.sold_date), n(r.annual_value), s(r.base_program_sold), s(r.status), s(r.salesperson),
  ].join('|')
}

async function syncLeads(admin: SupabaseClient, dryRun: boolean, report: BoardReport) {
  const items = await fetchBoardItems(BOARD_IDS.leads)
  const mondayLeads = items.map(transformLead)
  report.pulled = mondayLeads.length

  const { data: existing, error } = await admin
    .from('leads')
    .select('id, monday_item_id, first_name, last_name, phone, lead_creation_date, sold_date, annual_value, base_program_sold, status, salesperson')
  if (error) throw new Error(`leads read: ${error.message}`)
  const rows = existing ?? []

  const alreadyKeyed = new Set(rows.filter(r => r.monday_item_id).map(r => r.monday_item_id as string))
  // Bucket UNKEYED existing leads by full-tuple key -> queue of ids.
  const buckets = new Map<string, string[]>()
  for (const r of rows) {
    if (r.monday_item_id) continue
    const k = leadKey(r as any)
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k)!.push(r.id as string)
  }

  const assignments: { leadId: string; mondayId: string }[] = []
  const newLeads: LeadRow[] = []
  for (const ml of mondayLeads) {
    if (alreadyKeyed.has(ml.monday_item_id)) continue // already mapped — upsert refreshes it
    const q = buckets.get(leadKey(ml))
    if (q && q.length) assignments.push({ leadId: q.shift()!, mondayId: ml.monday_item_id })
    else newLeads.push(ml)
  }
  report.rekeyMatched = assignments.length
  report.newInserts = newLeads.length
  report.unmatchedExistingLeads = [...buckets.values()].reduce((a, q) => a + q.length, 0)

  if (!dryRun) {
    // 1. backfill monday_item_id onto matched existing leads
    for (const a of assignments) {
      const { error: uErr } = await admin.from('leads').update({ monday_item_id: a.mondayId }).eq('id', a.leadId)
      if (uErr) throw new Error(`leads re-key update: ${uErr.message}`)
    }
    // 2. upsert every Monday lead (refreshes keyed rows, inserts genuinely new)
    await upsertRows(admin, 'leads', mondayLeads)
    report.upserted = mondayLeads.length
    // 3. guarded hard-delete of keyed leads no longer in Monday
    const pulledIds = new Set(mondayLeads.map(l => l.monday_item_id))
    await guardedDelete(admin, 'leads', pulledIds, (q: any) => q, report)
  } else {
    report.upserted = 0
  }
}

async function syncSimpleBoard(
  admin: SupabaseClient,
  board: BoardKey,
  table: string,
  transform: (i: MondayItem) => any,
  dryRun: boolean,
  report: BoardReport
) {
  const items = await fetchBoardItems(BOARD_IDS[board])
  const rows = items.map(transform)
  report.pulled = rows.length
  if (dryRun) {
    report.upserted = 0
    return
  }
  await upsertRows(admin, table, rows)
  report.upserted = rows.length
  const pulledIds = new Set(rows.map(r => r.monday_item_id as string))
  // mirror rows are source='monday'; native rows (recurring source='sync') excluded
  await guardedDelete(admin, table, pulledIds, (q: any) => q.eq('source', 'monday'), report)
}

// ---- orchestration ----------------------------------------------------------

export async function runMondaySync(
  admin: SupabaseClient,
  opts: { dryRun?: boolean; boards?: BoardKey[] } = {}
): Promise<SyncReport> {
  const dryRun = !!opts.dryRun
  const boards = opts.boards ?? (['recurring', 'route', 'leads'] as BoardKey[])
  const report: SyncReport = { dryRun, boards: [], errors: [] }

  for (const board of boards) {
    const br: BoardReport = { board, pulled: 0, upserted: 0, deleted: 0 }
    try {
      if (board === 'recurring') {
        await syncSimpleBoard(admin, 'recurring', 'recurring_services', transformRecurring, dryRun, br)
      } else if (board === 'route') {
        await syncSimpleBoard(admin, 'route', 'route_capacity', transformRoute, dryRun, br)
      } else {
        await syncLeads(admin, dryRun, br)
      }
    } catch (e: any) {
      report.errors.push(`${board}: ${e?.message ?? String(e)}`)
    }
    report.boards.push(br)
  }
  return report
}
