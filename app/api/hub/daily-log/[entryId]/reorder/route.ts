import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { workOrderAccess } from '@/lib/work-order-access'
import { mergeOrder } from '@/lib/work-order-reorder'

// POST /api/hub/daily-log/:entryId/reorder   { stopIds: string[] }
//
// Work Orders Phase 5 — reorder stops at any time. `stopIds` is every open
// stop on the day (not done, not skipped, not removed by Jobber) in the order
// wanted. Finished and removed stops keep their numbers; the open ones take the
// rest in that order (lib/work-order-reorder.ts). Every stop is then stamped
// with `manual_rank`, which the Jobber sync honours — so the order survives the
// 10-minute sweep and webhooks until the optimizer re-sends the route.
//
// Who: a tech on their OWN day (primary or secondary tech), or the office
// (Work Orders admin) on anyone's. Ben, Oct 12 2026. Checked here, not just
// hidden on the screen.

type StopLite = { id: string; ord: number; status: string; removed_from_jobber_at: string | null }

export async function POST(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { entryId } = await params

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_admin_daily_log, can_access_daily_log_v2')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  const access = workOrderAccess(profile)
  if (!access.canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: entry } = await admin
    .from('daily_log_entries')
    .select('id, company_id, tech_user_id, secondary_tech_user_ids, completed_at, closed_at')
    .eq('id', entryId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!entry || entry.company_id !== profile.company_id) return NextResponse.json({ error: 'Day not found' }, { status: 404 })
  const isOwner = entry.tech_user_id === user.id || ((entry.secondary_tech_user_ids as string[] | null) ?? []).includes(user.id)
  if (!access.isAdmin && !isOwner) return NextResponse.json({ error: 'You can only reorder your own day.' }, { status: 403 })
  if (entry.closed_at) return NextResponse.json({ error: 'This day is closed.' }, { status: 409 })

  const body = await request.json().catch(() => ({})) as { stopIds?: unknown }
  const wanted = Array.isArray(body.stopIds) ? body.stopIds.filter((x): x is string => typeof x === 'string') : []
  if (wanted.length === 0) return NextResponse.json({ error: 'No stops to order.' }, { status: 400 })

  const { data: rows } = await admin
    .from('daily_log_stops')
    .select('id, ord, status, removed_from_jobber_at')
    .eq('entry_id', entryId)
  const stops = (rows ?? []) as StopLite[]
  const open = stops.filter(s => s.status !== 'complete' && s.status !== 'skipped' && !s.removed_from_jobber_at)
  const fixed = stops.filter(s => !open.some(o => o.id === s.id))
  const openIds = new Set(open.map(s => s.id))
  if (wanted.length !== openIds.size || wanted.some(id => !openIds.has(id)) || new Set(wanted).size !== wanted.length) {
    // The list changed under them (a stop finished, Jobber added one) — refresh.
    return NextResponse.json({ error: 'The day changed while you were reordering — refresh and try again.' }, { status: 409 })
  }

  const seq = mergeOrder(fixed.map(f => ({ id: f.id, ord: f.ord })), wanted)
  const want = new Map(seq.map((id, i) => [id, i + 1]))
  const cur = new Map(stops.map(s => [s.id, s.ord]))
  const moving = seq.filter(id => cur.get(id) !== want.get(id))

  // (entry_id, ord) is UNIQUE: park the movers in a random high block first
  // (same recipe as the sync — lib/work-orders-sync.ts), then settle them.
  const taken = stops.map(s => s.ord)
  let parkBase = 100_000
  for (let tries = 0; tries < 20; tries++) {
    const b = 100_000 + Math.floor(Math.random() * 1_000_000) * 1000
    if (!taken.some(o => o >= b && o < b + 1000)) { parkBase = b; break }
  }
  for (let i = 0; i < moving.length; i++) {
    const { error } = await admin.from('daily_log_stops').update({ ord: parkBase + i }).eq('id', moving[i])
    if (error) return NextResponse.json({ error: `Could not save the order: ${error.message}` }, { status: 500 })
  }
  const now = new Date().toISOString()
  for (const id of seq) {
    const n = want.get(id)!
    const patch: Record<string, unknown> = { manual_rank: n, updated_at: now }
    if (moving.includes(id)) patch.ord = n
    const { error } = await admin.from('daily_log_stops').update(patch).eq('id', id)
    if (error) return NextResponse.json({ error: `Could not save the order: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, ords: Object.fromEntries(want) })
}
