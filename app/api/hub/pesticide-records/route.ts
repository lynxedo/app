import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/hub/pesticide-records?from=YYYY-MM-DD&to=YYYY-MM-DD&q=<text>&limit=N
// Returns last N records (default 100, max 500) filtered by application date
// range and a fuzzy text search against customer/address/technician/chemical.
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
  const q = (searchParams.get('q') ?? '').trim()
  const rawLimit = parseInt(searchParams.get('limit') ?? '100', 10)
  const limit = Math.max(1, Math.min(500, Number.isFinite(rawLimit) ? rawLimit : 100))

  let query = supabase
    .from('pesticide_records')
    .select('id, application_timestamp, location_address, customer_name, technician_name, chemicals_applied, weather, jobber_visit_id, stop_id, daily_log_entry_id, line_items, location_lat, location_lng, technician_user_id, created_at')
    .eq('company_id', profile.company_id)
    .order('application_timestamp', { ascending: false })
    .limit(limit)

  if (from) query = query.gte('application_timestamp', `${from}T00:00:00`)
  if (to) query = query.lte('application_timestamp', `${to}T23:59:59`)
  if (q) {
    // Multi-column OR — postgrest ilike on customer_name OR address OR technician_name.
    // Chemical name match would require querying chemicals_applied jsonb which
    // is much more expensive; we'd add that as a follow-up if it's needed.
    const safe = q.replace(/[%_]/g, '\\$&')
    query = query.or(`customer_name.ilike.%${safe}%,location_address.ilike.%${safe}%,technician_name.ilike.%${safe}%`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ records: data ?? [] })
}
