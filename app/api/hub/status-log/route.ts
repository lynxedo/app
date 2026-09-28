import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// GET /api/hub/status-log?from=YYYY-MM-DD&to=YYYY-MM-DD
// Hours each person's dot spent Green / Yellow / Red / Offline, per the
// once-a-minute log (hub_status_intervals). Dates are Central time, inclusive.
// Admins and Hub admins only.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_admin_hub')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && !profile?.can_admin_hub) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const url = new URL(request.url)
  const from = url.searchParams.get('from') ?? ''
  const to = url.searchParams.get('to') ?? ''
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    return NextResponse.json({ error: 'Pick a valid date range' }, { status: 400 })
  }

  const admin = createAdminClient()
  const [totalsResult, usersResult, firstResult] = await Promise.all([
    admin.rpc('hub_status_totals', { p_company_id: profile.company_id, p_from_date: from, p_to_date: to }),
    admin
      .from('hub_users')
      .select('id, display_name')
      .eq('company_id', profile.company_id)
      .eq('is_bot', false),
    admin
      .from('hub_status_intervals')
      .select('started_at')
      .eq('company_id', profile.company_id)
      .order('started_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])
  if (totalsResult.error) return NextResponse.json({ error: totalsResult.error.message }, { status: 500 })

  const names = new Map<string, string>()
  for (const u of usersResult.data ?? []) names.set(u.id, u.display_name ?? 'Unknown')

  type Row = { user_id: string; name: string; available: number; busy: number; dnd: number; offline: number }
  const byUser = new Map<string, Row>()
  for (const r of (totalsResult.data ?? []) as { user_id: string; status: string; seconds: number }[]) {
    let row = byUser.get(r.user_id)
    if (!row) {
      row = { user_id: r.user_id, name: names.get(r.user_id) ?? 'Unknown', available: 0, busy: 0, dnd: 0, offline: 0 }
      byUser.set(r.user_id, row)
    }
    if (r.status === 'available' || r.status === 'busy' || r.status === 'dnd' || r.status === 'offline') {
      row[r.status] += Number(r.seconds) || 0
    }
  }

  const rows = [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json({ rows, tracking_since: firstResult.data?.started_at ?? null })
}
