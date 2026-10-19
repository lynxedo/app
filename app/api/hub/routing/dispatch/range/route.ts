import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { isoToLocal, type DispatchStop } from '@/lib/dispatch'

// Dispatch Week / Month views — a whole range of days for the chosen techs, read
// from the Hub Jobber MIRROR (a month live from Jobber would be hundreds of
// calls against the shared rate budget). The Day view stays live; clicking a
// day in Week/Month opens it. ⚠ The mirror holds visits only (no assessments or
// tasks) and marks anytime visits by a midnight start.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 42

export async function GET(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const { companyId } = auth
  const sp = new URL(request.url).searchParams
  const from = sp.get('from') ?? '', to = sp.get('to') ?? ''
  const techIds = (sp.get('techIds') ?? '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 8)
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) return NextResponse.json({ error: 'from/to (YYYY-MM-DD) required' }, { status: 400 })
  if ((new Date(to).getTime() - new Date(from).getTime()) / 86400000 > MAX_DAYS) return NextResponse.json({ error: 'Range too long' }, { status: 400 })
  if (techIds.length === 0) return NextResponse.json({ days: {} })

  const admin = createAdminClient()
  const { data: visits, error } = await admin.from('visits')
    .select('id, external_id, client_id, title, scheduled_date, start_at, end_at, completed_at, tech_external_user_ids')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .gte('scheduled_date', from).lte('scheduled_date', to)
    .overlaps('tech_external_user_ids', techIds)
    .order('start_at', { ascending: true })
    .limit(3000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = visits ?? []

  const clientIds = [...new Set(rows.map(v => v.client_id).filter(Boolean))] as string[]
  const visitIds = rows.map(v => v.id as string)
  const names = new Map<string, string>()
  for (let i = 0; i < clientIds.length; i += 200) {
    const { data } = await admin.from('clients').select('id, name, first_name, last_name, company_name').in('id', clientIds.slice(i, i + 200))
    for (const c of data ?? []) names.set(c.id as string, (c.name as string) || [c.first_name, c.last_name].filter(Boolean).join(' ') || (c.company_name as string) || '')
  }
  // The visit's own line items (never the job's — editing a visit forks its own copy).
  const items = new Map<string, string[]>()
  const totals = new Map<string, number>()
  for (let i = 0; i < visitIds.length; i += 200) {
    const { data } = await admin.from('line_items').select('parent_id, name, total')
      .eq('company_id', companyId).eq('parent_type', 'visit').is('deleted_at', null).in('parent_id', visitIds.slice(i, i + 200))
    for (const li of data ?? []) {
      const k = li.parent_id as string
      items.set(k, [...(items.get(k) ?? []), li.name as string])
      totals.set(k, (totals.get(k) ?? 0) + Number(li.total ?? 0))
    }
  }
  const extIds = rows.map(v => v.external_id as string).filter(Boolean)
  const lockedIds = new Set<string>()
  for (let i = 0; i < extIds.length; i += 200) {
    const { data } = await admin.from('dispatch_visit_locks').select('jobber_item_id').eq('company_id', companyId).in('jobber_item_id', extIds.slice(i, i + 200))
    for (const l of data ?? []) lockedIds.add(l.jobber_item_id as string)
  }

  const days: Record<string, Array<DispatchStop & { startMin: number | null; endMin: number | null; locked: boolean }>> = {}
  for (const v of rows) {
    if (!v.start_at || !v.external_id) continue
    const a = isoToLocal(v.start_at as string)
    const anytime = a.minutes === 0
    const b = v.end_at ? isoToLocal(v.end_at as string) : null
    const stop = {
      id: v.external_id as string,
      kind: 'visit' as const,
      clientName: names.get(v.client_id as string) ?? '',
      phone: null,
      address: '',
      routable: true,
      title: (v.title as string) ?? '',
      lineItemNames: items.get(v.id as string) ?? [],
      totalPrice: totals.get(v.id as string) ?? 0,
      instructions: null,
      startAt: v.start_at as string,
      endAt: (v.end_at as string | null) ?? null,
      allDay: anytime,
      isComplete: !!v.completed_at,
      arrivalStart: null,
      arrivalEnd: null,
      techIds: ((v.tech_external_user_ids ?? []) as string[]).filter(t => techIds.includes(t)),
      startMin: anytime ? null : a.minutes,
      endMin: anytime ? null : (b && b.date === a.date && b.minutes > a.minutes ? b.minutes : a.minutes + 30),
      locked: lockedIds.has(v.external_id as string),
    }
    ;(days[a.date] ??= []).push(stop)
  }
  return NextResponse.json({ days })
}
