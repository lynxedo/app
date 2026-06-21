import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/hub/pricer/charts
// Returns the live program price charts for the staff Pricer (/hub/pricer).
// Read rule (Master PRD §8.5 / Session 5): for each program_key, the PUBLISHED
// version with the latest effective_from that is <= today. Drafts/archived never
// surface; a future-dated published version waits until its date. A null
// effective_from is treated as "always effective". Gated to admins OR
// can_access_pricer. Presentation (category + sort_order) lives on the chart row.

// Business-local (America/Chicago) calendar date as YYYY-MM-DD.
function chicagoTodayStr(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const get = (t: string) => parts.find(p => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

type ChartRow = {
  program_key: string
  name: string
  description: string | null
  category: 'annual' | 'onetime' | 'addon' | null
  sort_order: number | null
  visits: number | null
  base_fee: number | null
  price_per_k: number | null
  version_label: string | null
  effective_from: string | null
  created_at: string
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_access_pricer')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  if (profile.role !== 'admin' && !profile.can_access_pricer) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const today = chicagoTodayStr()

  const { data, error } = await supabase
    .from('program_price_charts')
    .select('program_key, name, description, category, sort_order, visits, base_fee, price_per_k, version_label, effective_from, created_at')
    .eq('company_id', profile.company_id)
    .eq('status', 'published')
    .is('deleted_at', null)
    .or(`effective_from.is.null,effective_from.lte.${today}`)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // One winner per program_key: the latest effective_from <= today (null sorts
  // oldest), tie-broken by most-recently created.
  const best = new Map<string, ChartRow>()
  for (const row of (data ?? []) as ChartRow[]) {
    const cur = best.get(row.program_key)
    if (!cur) { best.set(row.program_key, row); continue }
    const a = row.effective_from ?? ''
    const b = cur.effective_from ?? ''
    if (a > b || (a === b && row.created_at > cur.created_at)) best.set(row.program_key, row)
  }

  const programs = [...best.values()]
    .map(r => ({
      program_key: r.program_key,
      name: r.name,
      description: r.description,
      category: r.category ?? 'other',
      sort_order: r.sort_order ?? 0,
      visits: Number(r.visits) || 0,
      base_fee: Number(r.base_fee) || 0,
      price_per_k: Number(r.price_per_k) || 0,
      version_label: r.version_label,
    }))
    .sort((a, b) =>
      a.sort_order - b.sort_order || a.name.localeCompare(b.name))

  const res = NextResponse.json({ programs })
  // Published charts change only when an admin republishes — let the browser
  // reuse a recent response for 5 min.
  res.headers.set('Cache-Control', 'private, max-age=300')
  return res
}
