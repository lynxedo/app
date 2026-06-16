// One-way Lynxedo -> Monday push for the Lead Tracker board.
//
// Companion to lib/monday-sync.ts (the Monday -> Lynxedo mirror). Once the team
// works the leads board IN Lynxedo, this keeps the Monday "2026 Lead Tracker"
// board current as a live, trustworthy fallback. Lynxedo is the system of record
// for leads; Monday is a mirror of it.
//
// Per lead it does exactly one of:
//   • already linked (has monday_item_id)  -> change_multiple_column_values + keep
//     the Monday group in step with the lead's stage (move_item_to_group)
//   • created in Lynxedo (no monday_item_id) -> create_item, then store the new
//     Monday id back on the lead so it stays linked forever after
//   • deleted in Lynxedo                    -> archive_item (reversible; never a
//     hard delete on the Monday side)
//
// Change tracking lives in a SEPARATE table (lead_monday_sync), not on the leads
// row: the leads.updated_at trigger fires on ANY write, so a marker stored on the
// row would re-bump updated_at and loop forever. The state table records the
// updated_at we last pushed; a lead is "changed" when leads.updated_at exceeds it.
// The state row also survives a lead's hard-delete, which is how we detect deletes.
//
// IMPORTANT: this only WRITES the leads board. The other two Tracker boards
// (recurring_services, route_capacity) remain pull-only mirrors.

import type { SupabaseClient } from '@supabase/supabase-js'
import { BOARD_IDS } from '@/lib/monday-sync'

const MONDAY_API = 'https://api.monday.com/v2'
const LEADS_BOARD_ID = BOARD_IDS.leads // '18392764674'
const HEROES_COMPANY_ID = '00000000-0000-0000-0000-000000000002'
// Abort the archive pass if the live lead set looks suspiciously small — a DB
// read glitch must never trigger a mass-archive of the Monday board.
const MIN_LIVE_FRACTION = 0.5

// Lynxedo lead.stage -> Monday group id (from get_board_info on the leads board).
const STAGE_TO_GROUP: Record<string, string> = {
  current: 'topics',
  appointment_set: 'group_mknz5zyn',
  follow_up_long_term: 'group_mknpch7r',
  closed_won: 'closed',
  upsells: 'group_mkyxapt9',
  closed_lost: 'new_group__1',
  closed_other: 'new_group56070__1',
  saves: 'group_mm298me4',
}

type Lead = {
  id: string
  monday_item_id: string | null
  stage: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
  service: string[] | null
  lead_source: string | null
  status: string | null
  lead_creation_date: string | null
  sold_date: string | null
  salesperson: string | null
  base_program_sold: string | null
  auxiliary_services: string[] | null
  annual_value: number | null
  updated_at: string
}

type StateRow = {
  lead_id: string
  monday_item_id: string
  last_pushed_updated_at: string
}

export type PushReport = {
  dryRun: boolean
  scanned: number
  created: number
  updated: number
  archived: number
  skipped: number
  archiveSkippedReason?: string
  errors: string[]
  createdNames?: string[]
  updatedNames?: string[]
  archivedItemIds?: string[]
}

// ---- Monday GraphQL (with variables + retry/backoff) ------------------------

const MAX_RETRIES = 3
const BACKOFF_BASE_MS = 1000
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function mondayGraphQL(query: string, variables: Record<string, any>, attempt = 0): Promise<any> {
  const token = process.env.MONDAY_API_TOKEN
  if (!token) throw new Error('MONDAY_API_TOKEN is not configured')
  try {
    const res = await fetch(MONDAY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
        'API-Version': '2024-10',
      },
      body: JSON.stringify({ query, variables }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json) throw new Error(`Monday API HTTP ${res.status}`)
    if (json.errors) throw new Error('Monday API error: ' + JSON.stringify(json.errors).slice(0, 400))
    return json.data
  } catch (e) {
    if (attempt < MAX_RETRIES) {
      await sleep(BACKOFF_BASE_MS * 2 ** attempt) // 1s, 2s, 4s
      return mondayGraphQL(query, variables, attempt + 1)
    }
    throw e
  }
}

// ---- column-value builder (mirror of lib/monday-sync transformLead) ---------
//
// Lynxedo is source of truth, so an empty Lynxedo field CLEARS the Monday column
// (empty string / empty labels / {}). create_labels_if_missing on the mutation
// means an unknown dropdown/status value is created rather than failing the write.

function displayName(l: Lead): string {
  const n = [l.first_name, l.last_name].filter(Boolean).join(' ').trim()
  return n || 'New Lead'
}

function labelsOf(arr: string[] | null): { labels: string[] } {
  return { labels: (arr ?? []).filter(Boolean) }
}
function singleLabels(v: string | null): { labels: string[] } {
  return { labels: v ? [v] : [] }
}
function statusVal(v: string | null): any {
  return v ? { label: v } : {}
}
function dateVal(v: string | null): any {
  // leads.lead_creation_date / sold_date are DATE columns -> 'YYYY-MM-DD'
  return v ? { date: v } : {}
}

function buildColumnValues(l: Lead): Record<string, any> {
  return {
    name: displayName(l),
    text_mm01h2aw: l.first_name ?? '',          // First Name
    text_mm01ne1y: l.last_name ?? '',           // Last Name
    text_mkp4hekd: l.phone ?? '',               // Phone Number
    text_mkp42w0x: l.email ?? '',               // Email Address
    dropdown_Mjj5nJ1I: labelsOf(l.service),     // Service (multi)
    dropdown__1: singleLabels(l.lead_source),   // Lead Source
    status__1: statusVal(l.status),             // Status
    color_mkpjhknz: statusVal(l.salesperson),   // Salesperson
    dropdown_mkxe4k2k: singleLabels(l.base_program_sold), // Base Program Sold
    dropdown_mkxe7j80: labelsOf(l.auxiliary_services),    // Auxiliary Services (multi)
    date1: dateVal(l.lead_creation_date),       // Lead Creation Date
    date9: dateVal(l.sold_date),                // Sold Date
    numbers: l.annual_value != null ? String(l.annual_value) : '', // Annual Value
  }
}

// ---- Monday mutations -------------------------------------------------------

async function createMondayItem(l: Lead): Promise<string> {
  const groupId = STAGE_TO_GROUP[l.stage ?? ''] ?? STAGE_TO_GROUP.current
  const data = await mondayGraphQL(
    `mutation ($name: String!, $groupId: String!, $cv: JSON!) {
       create_item(board_id: ${LEADS_BOARD_ID}, group_id: $groupId, item_name: $name,
         column_values: $cv, create_labels_if_missing: true) { id }
     }`,
    { name: displayName(l), groupId, cv: JSON.stringify(buildColumnValues(l)) }
  )
  const id = data?.create_item?.id
  if (!id) throw new Error('create_item returned no id')
  return String(id)
}

async function updateMondayItem(l: Lead): Promise<void> {
  await mondayGraphQL(
    `mutation ($itemId: ID!, $cv: JSON!) {
       change_multiple_column_values(board_id: ${LEADS_BOARD_ID}, item_id: $itemId,
         column_values: $cv, create_labels_if_missing: true) { id }
     }`,
    { itemId: l.monday_item_id, cv: JSON.stringify(buildColumnValues(l)) }
  )
  // Keep the Monday group in step with the lead's stage (idempotent no-op if same).
  const groupId = STAGE_TO_GROUP[l.stage ?? '']
  if (groupId) {
    await mondayGraphQL(
      `mutation ($itemId: ID!, $groupId: String!) {
         move_item_to_group(item_id: $itemId, group_id: $groupId) { id }
       }`,
      { itemId: l.monday_item_id, groupId }
    )
  }
}

async function archiveMondayItem(itemId: string): Promise<void> {
  await mondayGraphQL(
    `mutation ($itemId: ID!) { archive_item(item_id: $itemId) { id } }`,
    { itemId }
  )
}

// ---- orchestration ----------------------------------------------------------

const LEAD_COLUMNS =
  'id, monday_item_id, stage, first_name, last_name, phone, email, service, lead_source, ' +
  'status, lead_creation_date, sold_date, salesperson, base_program_sold, auxiliary_services, ' +
  'annual_value, updated_at'

export async function runMondayPush(
  admin: SupabaseClient,
  opts: { dryRun?: boolean; leadId?: string } = {}
): Promise<PushReport> {
  const dryRun = !!opts.dryRun
  const report: PushReport = {
    dryRun, scanned: 0, created: 0, updated: 0, archived: 0, skipped: 0,
    errors: [], createdNames: [], updatedNames: [], archivedItemIds: [],
  }

  // Load leads (optionally a single one for a targeted test).
  let leadQ = admin.from('leads').select(LEAD_COLUMNS).eq('company_id', HEROES_COMPANY_ID)
  if (opts.leadId) leadQ = leadQ.eq('id', opts.leadId)
  const { data: leadsData, error: leadsErr } = await leadQ
  if (leadsErr) throw new Error(`leads read: ${leadsErr.message}`)
  const leads = (leadsData ?? []) as unknown as Lead[]
  report.scanned = leads.length

  const { data: stateData, error: stateErr } = await admin
    .from('lead_monday_sync')
    .select('lead_id, monday_item_id, last_pushed_updated_at')
  if (stateErr) throw new Error(`lead_monday_sync read: ${stateErr.message}`)
  const state = (stateData ?? []) as unknown as StateRow[]
  const stateByLead = new Map(state.map(s => [s.lead_id, s]))

  // ---- archive Monday items for leads deleted in Lynxedo --------------------
  // Skip entirely on a single-lead test run.
  if (!opts.leadId) {
    const liveIds = new Set(leads.map(l => l.id))
    const orphans = state.filter(s => !liveIds.has(s.lead_id))
    if (orphans.length) {
      // Guard: a suspiciously small live set means a read glitch — don't mass-archive.
      if (leads.length === 0 || (state.length > 0 && leads.length < state.length * MIN_LIVE_FRACTION)) {
        report.archiveSkippedReason =
          `live leads (${leads.length}) < 50% of tracked rows (${state.length}) — archive aborted`
      } else {
        for (const o of orphans) {
          try {
            if (!dryRun) {
              await archiveMondayItem(o.monday_item_id)
              await admin.from('lead_monday_sync').delete().eq('lead_id', o.lead_id)
            }
            report.archived++
            report.archivedItemIds!.push(o.monday_item_id)
          } catch (e: any) {
            report.errors.push(`archive ${o.monday_item_id}: ${e?.message ?? String(e)}`)
          }
        }
      }
    }
  }

  // ---- push creates + updates ----------------------------------------------
  for (const l of leads) {
    const st = stateByLead.get(l.id)
    const hasItem = !!l.monday_item_id
    const changed = !st || !hasItem || new Date(l.updated_at) > new Date(st.last_pushed_updated_at)
    if (!changed) { report.skipped++; continue }

    try {
      if (!hasItem) {
        report.created++
        report.createdNames!.push(displayName(l))
        if (!dryRun) {
          const newId = await createMondayItem(l)
          // Back-write the link; the trigger bumps updated_at, so capture the new
          // value and store it as the synced point (else the next run re-pushes).
          const { data: upd, error: uErr } = await admin
            .from('leads').update({ monday_item_id: newId }).eq('id', l.id)
            .select('updated_at').single()
          if (uErr) throw new Error(`back-write monday_item_id: ${uErr.message}`)
          await admin.from('lead_monday_sync').upsert({
            lead_id: l.id, monday_item_id: newId,
            last_pushed_updated_at: upd!.updated_at,
            last_pushed_at: new Date().toISOString(), last_error: null,
          }, { onConflict: 'lead_id' })
        }
      } else {
        report.updated++
        report.updatedNames!.push(displayName(l))
        if (!dryRun) {
          await updateMondayItem(l)
          await admin.from('lead_monday_sync').upsert({
            lead_id: l.id, monday_item_id: l.monday_item_id!,
            last_pushed_updated_at: l.updated_at,
            last_pushed_at: new Date().toISOString(), last_error: null,
          }, { onConflict: 'lead_id' })
        }
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      report.errors.push(`${displayName(l)} (${l.id}): ${msg}`)
      if (!dryRun && hasItem) {
        await admin.from('lead_monday_sync')
          .update({ last_error: msg }).eq('lead_id', l.id)
      }
    }
  }

  report.createdNames = report.createdNames!.slice(0, 25)
  report.updatedNames = report.updatedNames!.slice(0, 25)
  report.archivedItemIds = report.archivedItemIds!.slice(0, 25)
  return report
}
