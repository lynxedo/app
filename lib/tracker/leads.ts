import type { SupabaseClient } from '@supabase/supabase-js'

export type LeadFilters = {
  search?: string
  stage?: string
  status?: string
  salesperson?: string
}

const LEAD_COLUMNS =
  'id, first_name, last_name, phone, email, service, lead_source, status, stage, lead_creation_date, sold_date, salesperson, base_program_sold, auxiliary_services, annual_value, service_address, created_at, updated_at'

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

  return leads.map(l => ({
    ...l,
    latest_note: latestNoteMap.get(l.id) ?? null,
    custom_values: colValMap.get(l.id) ?? {},
  }))
}
