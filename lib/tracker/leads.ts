import type { SupabaseClient } from '@supabase/supabase-js'

export type LeadFilters = {
  search?: string
  stage?: string
  status?: string
  salesperson?: string
}

const LEAD_COLUMNS =
  'id, first_name, last_name, phone, email, service, lead_source, status, stage, lead_creation_date, sold_date, salesperson, base_program_sold, auxiliary_services, annual_value, service_address, created_at, updated_at, stage_changed_at'

// The drip enrollment a lead cares about most, in priority order — a lead waiting
// on a human (replied) trumps one still in-sequence (active), etc. Newest
// enrollment breaks ties. Mirrors the color states the Board/Needs-me views render.
const DRIP_STATUS_RANK: Record<string, number> = {
  replied: 5, active: 4, exited: 3, completed: 2, opted_out: 1,
}

export type DripStatus = 'active' | 'replied' | 'completed' | 'opted_out' | 'exited' | 'failed'
export type LeadDrip = {
  status: DripStatus
  current_step_index: number
  next_run_at: string | null
  campaign_id: string
  campaign_name: string | null
}

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

  const leadIds = leads.map(l => l.id)

  // Fetch notes and custom column values in lead_id batches. Passing every
  // lead id in a single .in() builds a request URL that the API gateway
  // rejects once a company has a few hundred leads (the failure was silently
  // swallowed, leaving every custom column / latest note blank). Batching by
  // lead_id keeps each lead's rows together, so per-lead ordering is preserved.
  const ID_BATCH = 100
  async function fetchInBatches<T>(
    run: (chunk: string[]) => PromiseLike<{ data: T[] | null }>
  ): Promise<T[]> {
    const out: T[] = []
    for (let i = 0; i < leadIds.length; i += ID_BATCH) {
      const { data } = await run(leadIds.slice(i, i + ID_BATCH))
      if (data) out.push(...data)
    }
    return out
  }

  const [notesData, colValData] = await Promise.all([
    fetchInBatches<{ lead_id: string; note: string; created_by: string; created_at: string }>(chunk =>
      supabase
        .from('lead_notes')
        .select('lead_id, note, created_by, created_at')
        .in('lead_id', chunk)
        .order('created_at', { ascending: false })
    ),
    fetchInBatches<{ lead_id: string; column_id: string; value: string | null }>(chunk =>
      supabase
        .from('lead_column_values')
        .select('lead_id, column_id, value')
        .in('lead_id', chunk)
    ),
  ])

  const latestNoteMap = new Map<string, { note: string; created_by: string; created_at: string }>()
  for (const n of notesData) {
    if (!latestNoteMap.has(n.lead_id)) {
      latestNoteMap.set(n.lead_id, { note: n.note, created_by: n.created_by, created_at: n.created_at })
    }
  }

  const colValMap = new Map<string, Record<string, string | null>>()
  for (const cv of colValData) {
    if (!colValMap.has(cv.lead_id)) colValMap.set(cv.lead_id, {})
    colValMap.get(cv.lead_id)![cv.column_id] = cv.value
  }

  // Batched drip-enrollment join (same lead_id chunking as notes/columns). One row
  // per lead — the most-relevant enrollment — so cards can show a live drip-state
  // chip. Best-effort: a drip failure must never blank the tracker.
  const dripByLead = new Map<string, LeadDrip>()
  try {
    type DripRow = {
      lead_id: string | null
      status: string
      current_step_index: number
      next_run_at: string | null
      campaign_id: string
      enrolled_at: string | null
    }
    const enrollments = await fetchInBatches<DripRow>(chunk =>
      supabase
        .from('drip_enrollments')
        .select('lead_id, status, current_step_index, next_run_at, campaign_id, enrolled_at')
        .in('lead_id', chunk)
    )

    // Resolve campaign names once (usually a handful of campaigns).
    const campaignIds = [...new Set(enrollments.map(e => e.campaign_id).filter(Boolean))]
    const campaignNameById = new Map<string, string>()
    for (let i = 0; i < campaignIds.length; i += ID_BATCH) {
      const { data } = await supabase
        .from('drip_campaigns')
        .select('id, name')
        .in('id', campaignIds.slice(i, i + ID_BATCH))
      if (data) for (const c of data as { id: string; name: string }[]) campaignNameById.set(c.id, c.name)
    }

    // Pick the most-relevant enrollment per lead (rank, newest tiebreak).
    const bestByLead = new Map<string, DripRow>()
    for (const e of enrollments) {
      if (!e.lead_id) continue
      const cur = bestByLead.get(e.lead_id)
      if (!cur) { bestByLead.set(e.lead_id, e); continue }
      const er = DRIP_STATUS_RANK[e.status] ?? 0
      const cr = DRIP_STATUS_RANK[cur.status] ?? 0
      if (er > cr || (er === cr && (e.enrolled_at ?? '') > (cur.enrolled_at ?? ''))) {
        bestByLead.set(e.lead_id, e)
      }
    }
    for (const [leadId, e] of bestByLead) {
      dripByLead.set(leadId, {
        status: e.status as DripStatus,
        current_step_index: e.current_step_index,
        next_run_at: e.next_run_at,
        campaign_id: e.campaign_id,
        campaign_name: campaignNameById.get(e.campaign_id) ?? null,
      })
    }
  } catch {
    // Drip tables unavailable → leads simply render without drip chips.
  }

  return leads.map(l => ({
    ...l,
    latest_note: latestNoteMap.get(l.id) ?? null,
    custom_values: colValMap.get(l.id) ?? {},
    drip: dripByLead.get(l.id) ?? null,
  }))
}
