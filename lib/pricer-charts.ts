import type { SupabaseClient } from '@supabase/supabase-js'
import type { PriceTier, PricingUnit } from '@/lib/service-builder'

// The live program price charts — shared by the staff Pricer (/hub/pricer) and
// the quote builder's "Insert from Pricer" (Work Orders PRD Phase 4).
// Read rule (Master PRD §8.5 / Session 5): for each program_key, the PUBLISHED
// version with the latest effective_from that is <= today. Drafts/archived never
// surface; a future-dated published version waits until its date. A null
// effective_from is treated as "always effective". Presentation (category +
// sort_order) lives on the chart row. Callers do their own permission check.

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
  pricing_unit: PricingUnit | null
  tiers: PriceTier[] | null
  version_label: string | null
  effective_from: string | null
  created_at: string
}

export type LiveProgram = {
  program_key: string
  name: string
  description: string | null
  category: 'annual' | 'onetime' | 'addon' | 'other'
  sort_order: number
  visits: number
  base_fee: number
  price_per_k: number
  pricing_unit: PricingUnit
  tiers: PriceTier[] | null
  version_label: string | null
}

/** Throws on a query error. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadLivePrograms(db: SupabaseClient<any>, companyId: string): Promise<LiveProgram[]> {
  const today = chicagoTodayStr()
  const { data, error } = await db
    .from('program_price_charts')
    .select('program_key, name, description, category, sort_order, visits, base_fee, price_per_k, pricing_unit, tiers, version_label, effective_from, created_at')
    .eq('company_id', companyId)
    .eq('status', 'published')
    .is('deleted_at', null)
    .or(`effective_from.is.null,effective_from.lte.${today}`)
  if (error) throw new Error(error.message)

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

  return [...best.values()]
    .map(r => ({
      program_key: r.program_key,
      name: r.name,
      description: r.description,
      category: (r.category ?? 'other') as LiveProgram['category'],
      sort_order: r.sort_order ?? 0,
      visits: Number(r.visits) || 0,
      base_fee: Number(r.base_fee) || 0,
      price_per_k: Number(r.price_per_k) || 0,
      pricing_unit: (r.pricing_unit ?? 'sqft_k') as PricingUnit,
      tiers: r.tiers ?? null,
      version_label: r.version_label,
    }))
    .sort((a, b) =>
      a.sort_order - b.sort_order || a.name.localeCompare(b.name))
}
