import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'

// Hub route order — the order of a tech's stops on a day (Ben, Oct 20 2026).
// Jobber's API can't set the order of anytime visits, so this is where it
// lives: the map path, the stop numbers, the route sheet and (through the
// route sheet) the Work Order list follow it. Saved right away — no draft:
// nothing in Jobber changes when only the order does.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const sp = new URL(request.url).searchParams
  const from = sp.get('from') ?? '', to = sp.get('to') ?? from
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return NextResponse.json({ error: 'from/to required' }, { status: 400 })
  const techIds = (sp.get('techIds') ?? '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 8)
  const admin = createAdminClient()
  let q = admin.from('dispatch_route_order').select('route_date, jobber_user_id, item_ids')
    .eq('company_id', auth.companyId).gte('route_date', from).lte('route_date', to)
  if (techIds.length) q = q.in('jobber_user_id', techIds)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const orders: Record<string, string[]> = {}
  for (const r of data ?? []) orders[`${r.route_date}|${r.jobber_user_id}`] = (r.item_ids ?? []) as string[]
  return NextResponse.json({ orders })
}

export async function PUT(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const b = await request.json().catch(() => null) as { date?: string; techId?: string; ids?: unknown } | null
  if (!b?.date || !DATE_RE.test(b.date) || !b.techId) return NextResponse.json({ error: 'date and techId required' }, { status: 400 })
  const ids = Array.isArray(b.ids) ? (b.ids as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 200) : []
  const admin = createAdminClient()
  const { error } = await admin.from('dispatch_route_order').upsert({
    company_id: auth.companyId, route_date: b.date, jobber_user_id: b.techId, item_ids: ids,
    updated_by: auth.userId, updated_at: new Date().toISOString(),
  }, { onConflict: 'company_id,route_date,jobber_user_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
