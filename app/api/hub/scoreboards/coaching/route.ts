import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Data for the Call Coaching scoreboard (board '6'). Returns one light record per
// graded call across BOTH logs (Twilio dialer `calls` + Unitel `call_logs`),
// override-aware, date-ranged server-side. The client does all aggregation and
// the rep filter (instant, no re-fetch). Gated on can_access_coaching ALONE —
// admins do NOT bypass (rep-performance is manager-only).

type Cats = Record<string, string>

type Rec = {
  id: string
  source: 'dialer' | 'unitel'
  ts: string | null
  grade: string | null
  rep: string | null
  mustListen: boolean
  acknowledged: boolean
  phone: string | null
  headline: string | null
  cats: Cats | null
}

function compactCats(coachingJson: unknown): Cats | null {
  const cats = (coachingJson as { categories?: Record<string, { score?: string }> } | null)?.categories
  if (!cats || typeof cats !== 'object') return null
  const out: Cats = {}
  for (const [k, v] of Object.entries(cats)) {
    const s = (v as { score?: string })?.score
    if (typeof s === 'string') out[k] = s
  }
  return Object.keys(out).length ? out : null
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('user_profiles')
    .select('can_access_coaching, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.can_access_coaching !== true) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const companyId = profile.company_id || ''

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from') || '2000-01-01'
  const to = searchParams.get('to') || '2999-12-31'
  const fromTs = `${from}T00:00:00`
  const toTs = `${to}T23:59:59`

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [dialerRes, unitelRes, dialerRev, unitelRev] = await Promise.all([
    admin
      .from('calls')
      .select(
        'id, created_at, direction, from_number, to_number, handled_by, initiated_by, coaching_grade, coaching_must_listen, coaching_headline, coaching_json'
      )
      .eq('company_id', companyId)
      .not('coaching_grade', 'is', null)
      .gte('created_at', fromTs)
      .lte('created_at', toTs),
    admin
      .from('call_logs')
      .select('id, call_datetime, phone, rep_name, overall_grade, must_listen, headline, coaching_json')
      .eq('company_id', companyId)
      .not('overall_grade', 'is', null)
      .gte('call_datetime', fromTs)
      .lte('call_datetime', toTs),
    admin.from('call_coaching_reviews').select('call_id, override_grade, acknowledged').eq('call_source', 'dialer'),
    admin.from('call_coaching_reviews').select('call_id, override_grade, acknowledged').eq('call_source', 'unitel'),
  ])

  const revD: Record<string, { override_grade: string | null; acknowledged: boolean }> = {}
  for (const r of (dialerRev.data ?? []) as any[]) revD[r.call_id] = r
  const revU: Record<string, { override_grade: string | null; acknowledged: boolean }> = {}
  for (const r of (unitelRev.data ?? []) as any[]) revU[r.call_id] = r

  const dialer = (dialerRes.data ?? []) as any[]
  const unitel = (unitelRes.data ?? []) as any[]

  const userIds = Array.from(
    new Set(dialer.flatMap(c => [c.handled_by, c.initiated_by]).filter(Boolean) as string[])
  )
  const nameById: Record<string, string> = {}
  if (userIds.length) {
    const { data: users } = await admin.from('hub_users').select('id, display_name').in('id', userIds)
    for (const u of (users ?? []) as any[]) if (u.display_name) nameById[u.id] = u.display_name
  }

  const recs: Rec[] = []
  for (const c of dialer) {
    const rev = revD[c.id]
    const grade = rev?.override_grade ?? c.coaching_grade
    const agentId = (c.direction === 'inbound' ? c.handled_by : c.initiated_by) || c.handled_by || c.initiated_by
    recs.push({
      id: c.id,
      source: 'dialer',
      ts: c.created_at,
      grade,
      rep: agentId ? nameById[agentId] ?? null : null,
      mustListen: c.coaching_must_listen === true,
      acknowledged: rev?.acknowledged === true,
      phone: c.direction === 'inbound' ? c.from_number : c.to_number,
      headline: c.coaching_headline,
      cats: grade && grade !== 'N/A' ? compactCats(c.coaching_json) : null,
    })
  }
  for (const c of unitel) {
    const rev = revU[c.id]
    const grade = rev?.override_grade ?? c.overall_grade
    recs.push({
      id: c.id,
      source: 'unitel',
      ts: c.call_datetime,
      grade,
      // The old Unitel log can't reliably tie a call to a user (the name comes
      // from the transcript: Kathryn / Kathy / Kathryn Root, all the same person).
      // Attribute all legacy calls to Kathryn; the dialer uses the real user.
      rep: 'Kathryn',
      mustListen: c.must_listen === true,
      acknowledged: rev?.acknowledged === true,
      phone: c.phone,
      headline: c.headline,
      cats: grade && grade !== 'N/A' ? compactCats(c.coaching_json) : null,
    })
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const reps = (Array.from(new Set(recs.map(r => r.rep).filter(Boolean))) as string[]).sort()
  return NextResponse.json({ calls: recs, reps })
}
