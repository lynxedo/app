import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { workOrderAccess } from '@/lib/work-order-access'
import { isEditedByTech, MAX_SYNC_ATTEMPTS, type WorkOrderLineItem } from '@/lib/work-order-line-items'

// GET  /api/hub/work-orders/office — the office's three Work Orders lists
//      (Phase 2, PRD §4.4 / §6):
//        needsAttention — completed stops whose Jobber side hasn't landed
//                         (line items failed, or the visit isn't complete yet)
//        changed        — completed stops where a tech changed, added or
//                         accepted line items, until someone marks them seen
//        readyToInvoice — completed in Jobber through Work Orders, not on
//                         autopay, and the visit has no invoice yet
//        notes          — every stop with tech notes/photos in the window,
//                         newest note first (Ben, Oct 5: "add the notes/updates
//                         that the tech put in") — and every card in every list
//                         carries its stop's notes + photos
// POST /api/hub/work-orders/office { stopId, action: 'reviewed' } — "Got it" on
//      a Changed row.
// Work Orders admins only — workOrderAccess().isAdmin (lib/work-order-access.ts).

const LOOKBACK_DAYS = 30

async function gate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase
    .from('user_profiles').select('company_id, role, can_admin_daily_log, can_access_daily_log_v2').eq('id', user.id).single()
  if (!profile?.company_id) return { error: NextResponse.json({ error: 'No company' }, { status: 403 }) }
  if (!workOrderAccess(profile).isAdmin) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { userId: user.id, companyId: profile.company_id as string }
}

type StopRow = {
  id: string
  status: string
  client_name: string | null
  address: string | null
  jobber_visit_id: string | null
  jobber_job_id: string | null
  completed_at: string | null
  jobber_complete_pending: boolean
  jobber_completed_at: string | null
  jobber_complete_error: string | null
  jobber_autopay: boolean | null
  line_items_reviewed_at: string | null
  contact_id: string | null
  daily_log_entries: { company_id: string; log_date: string; tech_user_id: string } | Array<{ company_id: string; log_date: string; tech_user_id: string }>
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  const admin = createAdminClient()
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: stopsRaw } = await admin
    .from('daily_log_stops')
    .select('id, status, client_name, address, jobber_visit_id, jobber_job_id, completed_at, jobber_complete_pending, jobber_completed_at, jobber_complete_error, jobber_autopay, line_items_reviewed_at, contact_id, daily_log_entries!inner(company_id, log_date, tech_user_id)')
    .eq('daily_log_entries.company_id', g.companyId)
    .eq('status', 'complete')
    .gte('completed_at', since)
    .order('completed_at', { ascending: false })
    .limit(1000)
  const stops = (stopsRaw ?? []) as unknown as StopRow[]
  // (more stops are appended below — the ones that only have recent notes)
  const stopIds = stops.map(s => s.id)

  // Line items of those stops (only stops that have any — most never opened the list).
  const items = new Map<string, WorkOrderLineItem[]>()
  for (let i = 0; i < stopIds.length; i += 100) {
    const { data } = await admin
      .from('work_order_line_items')
      .select('id, stop_id, source, status, name, quantity, unit_price, orig_quantity, orig_unit_price, sync_state, sync_error, sync_attempts')
      .in('stop_id', stopIds.slice(i, i + 100)).is('deleted_at', null)
    for (const r of (data ?? []) as unknown as WorkOrderLineItem[]) {
      const arr = items.get(r.stop_id) ?? []
      arr.push({ ...r, quantity: Number(r.quantity), unit_price: Number(r.unit_price),
        orig_quantity: r.orig_quantity == null ? null : Number(r.orig_quantity),
        orig_unit_price: r.orig_unit_price == null ? null : Number(r.orig_unit_price) })
      items.set(r.stop_id, arr)
    }
  }

  // Tech names, Jobber links, and which visits already have an invoice.
  const techIds = [...new Set(stops.map(s => (Array.isArray(s.daily_log_entries) ? s.daily_log_entries[0] : s.daily_log_entries)?.tech_user_id).filter(Boolean))] as string[]
  const { data: techs } = techIds.length
    ? await admin.from('hub_users').select('id, display_name').in('id', techIds)
    : { data: [] as { id: string; display_name: string | null }[] }
  const techName = new Map((techs ?? []).map(t => [t.id as string, (t.display_name as string | null) ?? '']))

  const jobIds = [...new Set(stops.map(s => s.jobber_job_id).filter((x): x is string => !!x))]
  const jobLink = new Map<string, string | null>()
  for (let i = 0; i < jobIds.length; i += 100) {
    const { data } = await admin.from('jobs').select('external_id, jobber_web_uri')
      .eq('company_id', g.companyId).in('external_id', jobIds.slice(i, i + 100))
    for (const j of data ?? []) jobLink.set(j.external_id as string, (j.jobber_web_uri as string | null) ?? null)
  }

  const readyCandidates = stops.filter(s => s.jobber_completed_at && s.jobber_autopay !== true && s.jobber_visit_id)
  const invoiced = new Set<string>()
  const visitIds = readyCandidates.map(s => s.jobber_visit_id as string)
  for (let i = 0; i < visitIds.length; i += 100) {
    const { data } = await admin.from('visits').select('external_id, invoice_external_id, deleted_at')
      .eq('company_id', g.companyId).in('external_id', visitIds.slice(i, i + 100))
    for (const v of data ?? []) if (v.invoice_external_id || v.deleted_at) invoiced.add(v.external_id as string)
  }

  // Tech notes + photos. The Notes list covers stops in any state (a note on a
  // stop still in progress matters too), so read the notes first, then the
  // stops they belong to that the completed-stops query didn't already load.
  const { data: recentNotes } = await admin
    .from('daily_log_stop_messages')
    .select('stop_id, created_at')
    .eq('company_id', g.companyId).is('deleted_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000)
  const latestNoteAt = new Map<string, string>()
  for (const n of recentNotes ?? []) if (!latestNoteAt.has(n.stop_id as string)) latestNoteAt.set(n.stop_id as string, n.created_at as string)
  const { data: recentPhotos } = await admin
    .from('daily_log_stop_attachments')
    .select('stop_id, created_at, daily_log_stops!inner(daily_log_entries!inner(company_id))')
    .eq('daily_log_stops.daily_log_entries.company_id', g.companyId)
    .gte('created_at', since)
    .limit(2000)
  for (const a of recentPhotos ?? []) {
    const cur = latestNoteAt.get(a.stop_id as string)
    if (!cur || (a.created_at as string) > cur) latestNoteAt.set(a.stop_id as string, a.created_at as string)
  }
  const known = new Set(stopIds)
  const missing = [...latestNoteAt.keys()].filter(id => !known.has(id))
  for (let i = 0; i < missing.length; i += 100) {
    const { data } = await admin
      .from('daily_log_stops')
      .select('id, status, client_name, address, jobber_visit_id, jobber_job_id, completed_at, jobber_complete_pending, jobber_completed_at, jobber_complete_error, jobber_autopay, line_items_reviewed_at, contact_id, daily_log_entries!inner(company_id, log_date, tech_user_id)')
      .eq('daily_log_entries.company_id', g.companyId)
      .in('id', missing.slice(i, i + 100))
    stops.push(...((data ?? []) as unknown as StopRow[]))
  }
  const allIds = stops.map(s => s.id)
  const notesBy = new Map<string, Array<{ author: string; content: string; at: string; edited: boolean }>>()
  const photosBy = new Map<string, Array<{ url: string; type: string | null; name: string | null }>>()
  for (let i = 0; i < allIds.length; i += 100) {
    const slice = allIds.slice(i, i + 100)
    const [{ data: msgs }, { data: atts }] = await Promise.all([
      admin.from('daily_log_stop_messages')
        .select('stop_id, content, created_at, edited_at, user:hub_users!user_id(display_name)')
        .in('stop_id', slice).is('deleted_at', null)
        .order('created_at', { ascending: true }),
      admin.from('daily_log_stop_attachments')
        .select('stop_id, file_url, file_type, file_name, created_at')
        .in('stop_id', slice)
        .order('created_at', { ascending: true }),
    ])
    for (const m of msgs ?? []) {
      const u = (Array.isArray(m.user) ? m.user[0] : m.user) as { display_name?: string } | null
      const arr = notesBy.get(m.stop_id as string) ?? []
      arr.push({ author: u?.display_name ?? '', content: m.content as string, at: m.created_at as string, edited: !!m.edited_at })
      notesBy.set(m.stop_id as string, arr)
    }
    for (const a of atts ?? []) {
      const arr = photosBy.get(a.stop_id as string) ?? []
      arr.push({ url: a.file_url as string, type: (a.file_type as string | null) ?? null, name: (a.file_name as string | null) ?? null })
      photosBy.set(a.stop_id as string, arr)
    }
  }
  // Tech names for stops that only came in through their notes.
  const extraTechs = [...new Set(stops.map(s => (Array.isArray(s.daily_log_entries) ? s.daily_log_entries[0] : s.daily_log_entries)?.tech_user_id).filter((t): t is string => !!t && !techName.has(t)))]
  if (extraTechs.length) {
    const { data: more } = await admin.from('hub_users').select('id, display_name').in('id', extraTechs)
    for (const t of more ?? []) techName.set(t.id as string, (t.display_name as string | null) ?? '')
  }

  const shape = (s: StopRow, extra: Record<string, unknown> = {}) => {
    const e = Array.isArray(s.daily_log_entries) ? s.daily_log_entries[0] : s.daily_log_entries
    const its = (items.get(s.id) ?? []).filter(li => li.status === 'accepted')
    return {
      stopId: s.id,
      date: e?.log_date ?? null,
      tech: e?.tech_user_id ? techName.get(e.tech_user_id) ?? '' : '',
      client: s.client_name ?? '',
      address: s.address ?? '',
      contactId: s.contact_id,
      completedAt: s.completed_at,
      autopay: s.jobber_autopay,
      jobberUrl: s.jobber_job_id ? jobLink.get(s.jobber_job_id) ?? null : null,
      total: its.reduce((sum, li) => sum + li.quantity * li.unit_price, 0),
      status: s.status,
      notes: notesBy.get(s.id) ?? [],
      photos: photosBy.get(s.id) ?? [],
      ...extra,
    }
  }

  // The three line-item lists are about COMPLETED stops only (the notes list
  // brought in stops in other states too).
  const done = stops.filter(s => s.status === 'complete')
  const needsAttention = done
    .filter(s => s.jobber_complete_pending || (items.get(s.id) ?? []).some(li => li.status === 'accepted' && li.sync_state === 'error'))
    .map(s => {
      const failing = (items.get(s.id) ?? []).filter(li => li.status === 'accepted' && li.sync_state === 'error')
      return shape(s, {
        problem: s.jobber_complete_error ?? (failing.length ? `${failing.length} line item(s) not in Jobber` : 'Not complete in Jobber yet'),
        failingItems: failing.map(li => ({
          name: li.name, error: li.sync_error, gaveUp: li.sync_attempts >= MAX_SYNC_ATTEMPTS,
        })),
      })
    })

  const changed = done
    .filter(s => !s.line_items_reviewed_at)
    .map(s => ({ s, its: (items.get(s.id) ?? []).filter(li => li.status === 'accepted' && (li.source !== 'jobber' || isEditedByTech(li))) }))
    .filter(x => x.its.length > 0)
    .map(({ s, its }) => shape(s, {
      changes: its.map(li => ({
        name: li.name,
        kind: li.source === 'jobber' ? (li.quantity === 0 ? 'not_done' : 'changed') : li.source === 'tech_added' ? 'added' : 'suggested',
        quantity: li.quantity,
        unitPrice: li.unit_price,
        origQuantity: li.orig_quantity,
        origUnitPrice: li.orig_unit_price,
      })),
    }))

  const readyToInvoice = readyCandidates
    .filter(s => !invoiced.has(s.jobber_visit_id as string))
    .map(s => shape(s))

  const notes = stops
    .filter(s => latestNoteAt.has(s.id))
    .sort((a, b) => (latestNoteAt.get(b.id) ?? '').localeCompare(latestNoteAt.get(a.id) ?? ''))
    .map(s => shape(s, { lastNoteAt: latestNoteAt.get(s.id) }))

  return NextResponse.json({ needsAttention, changed, readyToInvoice, notes })
}

export async function POST(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  let body: { stopId?: unknown; action?: unknown } = {}
  try { body = await req.json() } catch { /* empty */ }
  if (typeof body.stopId !== 'string' || body.action !== 'reviewed') {
    return NextResponse.json({ error: 'stopId and action are required' }, { status: 400 })
  }
  const admin = createAdminClient()
  const { data: stop } = await admin
    .from('daily_log_stops').select('id, daily_log_entries!inner(company_id)')
    .eq('id', body.stopId).eq('daily_log_entries.company_id', g.companyId).maybeSingle()
  if (!stop) return NextResponse.json({ error: 'Stop not found' }, { status: 404 })
  await admin.from('daily_log_stops')
    .update({ line_items_reviewed_at: new Date().toISOString(), line_items_reviewed_by: g.userId })
    .eq('id', body.stopId)
  return NextResponse.json({ ok: true })
}
