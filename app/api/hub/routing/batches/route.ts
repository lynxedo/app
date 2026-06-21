import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Session 73.2 — Advanced Routing holding area.
// A batch is a lassoed + optimized set of stops parked for a future day/tech.
// Persists across browser sessions until sent to Jobber / Daily Log or deleted.
// Reads use the user-session client (RLS company-scopes via get_my_company_id());
// writes use the service-role admin client (route_batches has no write policy).

interface BatchStop {
  ord: number
  jobber_visit_id: string
  client_name: string
  client_phone?: string | null
  address: string
  lat?: number | null
  lng?: number | null
  job_title?: string | null
  line_items?: Array<{ name: string; qty: number; unitPrice: number; totalPrice: number }>
  instructions?: string | null
  services?: string
  total_price?: number
  eta?: string
  start_at_iso?: string | null
  end_at_iso?: string | null
  drive_minutes?: number
  onsite_minutes?: number
  distance_km?: number
}

interface CreateBatchRequest {
  label?: string | null
  assigned_date: string                 // YYYY-MM-DD
  assigned_tech_jobber_id?: string | null
  assigned_tech_name?: string | null
  stops: BatchStop[]
  total_drive_minutes?: number
  total_onsite_minutes?: number
  total_miles?: number
  depot_lat?: number | null
  depot_lng?: number | null
  tank_overrides?: Record<string, number> | null  // product_id → tank_number (Part B), kept for the DL v2 loadout
}

// GET — list this company's holding-area batches (newest day first).
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // RLS scopes this to the caller's company automatically.
  const { data, error } = await supabase
    .from('route_batches')
    .select('*')
    .order('assigned_date', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ batches: data ?? [] })
}

// POST — create a batch from the currently optimized + lassoed selection.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  let body: CreateBatchRequest
  try {
    body = (await request.json()) as CreateBatchRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.assigned_date || typeof body.assigned_date !== 'string') {
    return NextResponse.json({ error: 'assigned_date required' }, { status: 400 })
  }
  if (!Array.isArray(body.stops) || body.stops.length === 0) {
    return NextResponse.json({ error: 'stops must be a non-empty array' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('route_batches')
    .insert({
      company_id: profile.company_id,
      created_by: user.id,
      label: body.label?.trim() || null,
      assigned_date: body.assigned_date,
      assigned_tech_jobber_id: body.assigned_tech_jobber_id ?? null,
      assigned_tech_name: body.assigned_tech_name ?? null,
      stops: body.stops,
      total_drive_minutes: Math.round(body.total_drive_minutes ?? 0),
      total_onsite_minutes: Math.round(body.total_onsite_minutes ?? 0),
      total_miles: body.total_miles ?? 0,
      depot_lat: body.depot_lat ?? null,
      depot_lng: body.depot_lng ?? null,
      tank_overrides: body.tank_overrides ?? null,
    })
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create batch' }, { status: 500 })
  }
  return NextResponse.json({ batch: data })
}
