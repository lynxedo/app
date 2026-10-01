import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/hub/contacts/:id/work-orders
//
// Work Orders Phase 1 (Reference/PRDs/WORK_ORDERS_AND_QUOTES_PRD.md §6 Phase 1,
// "Customer file ← stops"): every Daily Log v2 stop ("work order") linked to this
// customer, newest day first, with the irrigation inspection done on it when
// there is one. Read-only. Anyone who can open the customer file (can_access_hub,
// same company) can read it — Ben, Oct 1 2026: every tech may see the customer
// file.

type StopRow = {
  id: string
  ord: number
  status: string
  job_title: string | null
  line_items: { name?: string }[] | null
  arrived_at: string | null
  completed_at: string | null
  jobber_visit_id: string | null
  skip_reason_label: string | null
  entry: {
    id: string
    log_date: string
    company_id: string
    deleted_at: string | null
    tech: { display_name: string } | null
  } | null
}

type InspLite = { id: string; status: string; jobber_visit_id: string | null; stop_id: string | null }

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: contactId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_hub')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id || !profile.can_access_hub) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const companyId = profile.company_id as string

  const admin = createAdminClient()
  const { data: contact } = await admin
    .from('txt_contacts')
    .select('id, company_id')
    .eq('id', contactId)
    .maybeSingle()
  if (!contact || contact.company_id !== companyId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: rows } = await admin
    .from('daily_log_stops')
    .select('id, ord, status, job_title, line_items, arrived_at, completed_at, jobber_visit_id, skip_reason_label, entry:daily_log_entries!entry_id(id, log_date, company_id, deleted_at, tech:hub_users!tech_user_id(display_name))')
    .eq('contact_id', contactId)
    .limit(200)

  // Company scope + soft-deleted days are filtered here: the embed can't be
  // used as a filter in a single PostgREST call without !inner, and we want a
  // stop whose day was deleted to disappear rather than 500.
  const stops = ((rows ?? []) as unknown as StopRow[])
    .filter(s => s.entry && s.entry.company_id === companyId && !s.entry.deleted_at)
    .sort((a, b) => {
      const d = (b.entry!.log_date).localeCompare(a.entry!.log_date)
      return d !== 0 ? d : a.ord - b.ord
    })

  // Inspections keyed on the Jobber visit id (stable across a route re-send),
  // falling back to the stop id. A draft outranks a final for the same visit.
  const visitIds = stops.map(s => s.jobber_visit_id).filter((x): x is string => !!x)
  const stopIds = stops.map(s => s.id)
  const byVisit = new Map<string, InspLite>()
  const byStop = new Map<string, InspLite>()
  if (stops.length > 0) {
    const orParts = [
      visitIds.length > 0 ? `jobber_visit_id.in.(${visitIds.map(v => `"${v}"`).join(',')})` : null,
      `stop_id.in.(${stopIds.join(',')})`,
    ].filter((x): x is string => !!x)
    const { data: insps } = await admin
      .from('irrigation_inspections')
      .select('id, status, jobber_visit_id, stop_id')
      .eq('company_id', companyId)
      .eq('contact_id', contactId)
      .or(orParts.join(','))
      .order('finalized_at', { ascending: false, nullsFirst: true })
    for (const i of (insps ?? []) as InspLite[]) {
      if (i.jobber_visit_id) {
        const cur = byVisit.get(i.jobber_visit_id)
        if (!cur || (i.status === 'draft' && cur.status !== 'draft')) byVisit.set(i.jobber_visit_id, i)
      }
      if (i.stop_id) {
        const cur = byStop.get(i.stop_id)
        if (!cur || (i.status === 'draft' && cur.status !== 'draft')) byStop.set(i.stop_id, i)
      }
    }
  }

  const workOrders = stops.map(s => {
    const insp = (s.jobber_visit_id ? byVisit.get(s.jobber_visit_id) : undefined) ?? byStop.get(s.id) ?? null
    const services = Array.isArray(s.line_items)
      ? s.line_items.map(li => (li?.name ?? '').trim()).filter(Boolean)
      : []
    return {
      id: s.id,
      date: s.entry!.log_date,
      tech: s.entry!.tech?.display_name ?? null,
      status: s.status,
      skipReason: s.skip_reason_label,
      jobTitle: s.job_title,
      services,
      arrivedAt: s.arrived_at,
      completedAt: s.completed_at,
      inspection: insp ? { id: insp.id, status: insp.status === 'final' ? 'final' : 'draft' } : null,
    }
  })

  return NextResponse.json({ workOrders })
}
