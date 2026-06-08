// Replicates the Monday cross-board automation:
//   "1 day after Sold Date arrives, IF Base Program Sold is a recurring plan,
//    duplicate the item and move it to the Recurring Services board."
//
// In Lynxedo this reads the Lead Tracker (public.leads) and creates matching
// rows in public.recurring_services. Idempotent: a lead is only synced once
// (dedup on recurring_services.lead_id). The "+1 day" delay is honored by only
// processing leads whose sold_date is at least one full day in the past.
//
// Monday's companion automations are handled too:
//   - "remove (copy) suffix on create"  -> we never add a (copy) suffix, so n/a.
//   - "Cancelled? -> Upgraded moves group" -> DB trigger recurring_services_move_upgraded.

import type { SupabaseClient } from '@supabase/supabase-js'

// Base Program Sold values that count as recurring (Ben-confirmed). One-time
// work and non-recurring WF plans (Monthly, Organic, Special Reduced) are excluded.
export const RECURRING_BASE_PROGRAMS = [
  'IR - Irrigation Service Plan Bronze',
  'IR - Irrigation Service Plan Silver',
  'IR - Irrigation Service Plan Gold',
  'MO - Dunks',
  'MO - Mosquito Control',
  'PW - Pet Waste Removal Weekly',
  'PW - Pet Waste Removal Biweekly',
  'PW - Pet Waste Removal 2x Week',
  'WF - Lawn Health Basic',
  'WF - Lawn Health Complete',
  'WF - Lawn Health Plus',
  'WF - Root Rot Recovery',
]

type LeadRow = {
  id: string
  company_id: string
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
}

export type SyncResult = {
  candidates: number          // qualifying leads found
  alreadySynced: number       // skipped (already have a recurring row)
  created: number             // rows inserted (0 when dryRun)
  dryRun: boolean
  createdNames: string[]
}

function cutoffDate(): string {
  // "1 day after sold date" => sold_date must be <= yesterday.
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export async function syncSoldLeadsToRecurring(
  admin: SupabaseClient,
  opts: { dryRun?: boolean } = {}
): Promise<SyncResult> {
  const dryRun = !!opts.dryRun

  const { data: leads, error } = await admin
    .from('leads')
    .select('id, company_id, first_name, last_name, phone, email, service, lead_source, status, lead_creation_date, sold_date, salesperson, base_program_sold, auxiliary_services, annual_value')
    .in('base_program_sold', RECURRING_BASE_PROGRAMS)
    .not('sold_date', 'is', null)
    .lte('sold_date', cutoffDate())

  if (error) throw new Error(error.message)
  const candidates = (leads ?? []) as LeadRow[]
  if (candidates.length === 0) {
    return { candidates: 0, alreadySynced: 0, created: 0, dryRun, createdNames: [] }
  }

  // Which leads already have a recurring_services row?
  const leadIds = candidates.map(l => l.id)
  const { data: existing } = await admin
    .from('recurring_services')
    .select('lead_id')
    .in('lead_id', leadIds)
  const synced = new Set((existing ?? []).map(r => r.lead_id as string))

  const toCreate = candidates.filter(l => !synced.has(l.id))
  const rows = toCreate.map(l => ({
    company_id: l.company_id,
    source: 'sync',
    lead_id: l.id,
    monday_group: 'Customers',
    name: [l.first_name, l.last_name].filter(Boolean).join(' ') || null,
    phone: l.phone,
    email: l.email,
    service: l.service,
    lead_source: l.lead_source,
    status: l.status,
    lead_creation_date: l.lead_creation_date,
    annual_value: l.annual_value,
    sold_date: l.sold_date,
    salesperson: l.salesperson,
    base_program_sold: l.base_program_sold,
    auxiliary_services: l.auxiliary_services,
    cancelled_status: 'Active',
  }))

  const result: SyncResult = {
    candidates: candidates.length,
    alreadySynced: synced.size,
    created: 0,
    dryRun,
    createdNames: rows.map(r => r.name ?? '(unnamed)'),
  }

  if (dryRun || rows.length === 0) return result

  const { error: insErr } = await admin.from('recurring_services').insert(rows)
  if (insErr) throw new Error(insErr.message)
  result.created = rows.length
  return result
}
