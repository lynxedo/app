import type { SupabaseClient } from '@supabase/supabase-js'

export type LeadFilters = {
  search?: string
  stage?: string
  status?: string
  salesperson?: string
}

const LEAD_COLUMNS =
  'id, first_name, last_name, phone, email, service, lead_source, status, stage, lead_creation_date, sold_date, salesperson, base_program_sold, auxiliary_services, annual_value, service_address, created_at, updated_at'

/**
 * Fetch leads (optionally filtered) plus the latest note per lead.
 *
 * Shared by the GET /api/tracker/leads route (filtered, client-driven) and the
 * Lead Tracker server component (unfiltered, for first-paint prefetch) so the
 * two never drift. RLS scopes rows to the caller's company.
 */
export async function fetchLeadsWithNotes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
  filters: LeadFilters = {}
) {
  const { search = '', stage = '', status = '', salesperson = '' } = filters

  let query = supabase
    .from('leads')
    .select(LEAD_COLUMNS)
    .order('created_at', { ascending: false })

  if (stage) query = query.eq('stage', stage)
  if (status) query = query.eq('status', status)
  if (salesperson) query = query.eq('salesperson', salesperson)
  if (search) {
    query = query.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`
    )
  }

  const { data: leads, error } = await query
  if (error) throw error
  if (!leads || leads.length === 0) return []

  // Latest note per lead — one query, newest-first, take the first hit per id.
  const leadIds = leads.map(l => l.id)
  const { data: notes } = await supabase
    .from('lead_notes')
    .select('lead_id, note, created_by, created_at')
    .in('lead_id', leadIds)
    .order('created_at', { ascending: false })

  const latestNoteMap = new Map<string, { note: string; created_by: string; created_at: string }>()
  for (const n of notes ?? []) {
    if (!latestNoteMap.has(n.lead_id)) {
      latestNoteMap.set(n.lead_id, { note: n.note, created_by: n.created_by, created_at: n.created_at })
    }
  }

  return leads.map(l => ({ ...l, latest_note: latestNoteMap.get(l.id) ?? null }))
}
