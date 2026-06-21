import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type ChemicalApplied = {
  matched_line_item?: string
  matched_line_item_qty?: number | null
  matched_line_item_total?: number | null
  chemical_name?: string
  epa_registration_number?: string | null
  active_ingredients?: string | null
  target_pests?: string | null
  application_rate?: string | null
}

type WeatherSnap = {
  temperature_f?: number | null
  conditions?: string | null
  wind_mph?: number | null
  humidity_pct?: number | null
} | null

type RecordRow = {
  id: string
  application_timestamp: string
  location_address: string | null
  location_lat: number | null
  location_lng: number | null
  customer_name: string | null
  technician_name: string | null
  jobber_visit_id: string | null
  chemicals_applied: ChemicalApplied[] | null
  weather: WeatherSnap
}

// One CSV row per chemical applied (TDA records each product separately, so a
// stop with 2 matching line items yields 2 rows). Easier to import into TDA's
// own systems than packing multiple chemicals into one row.
const CSV_HEADERS = [
  'Record ID',
  'Application Date',
  'Application Time',
  'Customer',
  'Address',
  'Latitude',
  'Longitude',
  'Applicator',
  'Chemical / Product',
  'EPA Registration #',
  'Active Ingredients',
  'Target Pests',
  'Application Rate',
  'Matched Line Item',
  'Temperature (°F)',
  'Conditions',
  'Wind (mph)',
  'Humidity (%)',
  'Jobber Visit ID',
]

function escapeCsv(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function formatLocalDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Chicago' })
}

function formatLocalTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Chicago' })
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  // epa_only=1 → TDA pesticide-compliance export: only EPA-registered products.
  // Default (all products) includes fertilizers and other non-EPA products.
  const epaOnly = searchParams.get('epa_only') === '1'

  let query = supabase
    .from('pesticide_records')
    .select('id, application_timestamp, location_address, location_lat, location_lng, customer_name, technician_name, jobber_visit_id, chemicals_applied, weather')
    .eq('company_id', profile.company_id)
    .order('application_timestamp', { ascending: false })

  if (from) query = query.gte('application_timestamp', `${from}T00:00:00`)
  if (to) query = query.lte('application_timestamp', `${to}T23:59:59`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const lines: string[] = [CSV_HEADERS.map(escapeCsv).join(',')]

  for (const r of (data ?? []) as RecordRow[]) {
    let chemicals = Array.isArray(r.chemicals_applied) ? r.chemicals_applied : []
    // TDA export: keep only EPA-registered products; drop the record entirely
    // if nothing qualifies (so fertilizer-only visits don't appear).
    if (epaOnly) {
      chemicals = chemicals.filter(c => (c.epa_registration_number ?? '').trim() !== '')
      if (chemicals.length === 0) continue
    }
    const w = r.weather ?? null

    if (chemicals.length === 0) {
      // Defensive: shouldn't happen since we only create records when matches
      // exist, but render a row anyway so the record isn't silently dropped.
      lines.push([
        r.id,
        formatLocalDate(r.application_timestamp),
        formatLocalTime(r.application_timestamp),
        r.customer_name ?? '',
        r.location_address ?? '',
        r.location_lat ?? '',
        r.location_lng ?? '',
        r.technician_name ?? '',
        '', '', '', '', '', '',
        w?.temperature_f ?? '',
        w?.conditions ?? '',
        w?.wind_mph ?? '',
        w?.humidity_pct ?? '',
        r.jobber_visit_id ?? '',
      ].map(escapeCsv).join(','))
      continue
    }

    for (const c of chemicals) {
      lines.push([
        r.id,
        formatLocalDate(r.application_timestamp),
        formatLocalTime(r.application_timestamp),
        r.customer_name ?? '',
        r.location_address ?? '',
        r.location_lat ?? '',
        r.location_lng ?? '',
        r.technician_name ?? '',
        c.chemical_name ?? '',
        c.epa_registration_number ?? '',
        c.active_ingredients ?? '',
        c.target_pests ?? '',
        c.application_rate ?? '',
        c.matched_line_item ?? '',
        w?.temperature_f ?? '',
        w?.conditions ?? '',
        w?.wind_mph ?? '',
        w?.humidity_pct ?? '',
        r.jobber_visit_id ?? '',
      ].map(escapeCsv).join(','))
    }
  }

  const csv = lines.join('\r\n') + '\r\n'
  const dateRange = (from || to) ? `_${from ?? 'earliest'}_to_${to ?? 'latest'}` : ''
  const filename = `${epaOnly ? 'tda-pesticide-records' : 'products-used'}${dateRange}.csv`

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
