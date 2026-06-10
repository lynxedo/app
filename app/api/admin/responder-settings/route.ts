import { NextRequest, NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const auth = await requireAdminArea('dialer')
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const admin = createAdminClient()
  const { data } = await admin
    .from('responder_settings')
    .select('*')
    .eq('company_id', auth.company_id!)
    .maybeSingle()

  return NextResponse.json(data ?? null)
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminArea('dialer')
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const allowed = [
    'mode', 'business_days', 'business_hours_start', 'business_hours_end',
    'business_hours_template', 'business_hours_no_message_template',
    'afterhours_template', 'afterhours_no_message_template',
  ]

  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  const admin = createAdminClient()

  // Check if a row already exists for this company
  const { data: existing } = await admin
    .from('responder_settings')
    .select('id')
    .eq('company_id', auth.company_id!)
    .maybeSingle()

  let result
  if (existing) {
    result = await admin
      .from('responder_settings')
      .update(update)
      .eq('id', existing.id)
      .select()
      .single()
  } else {
    result = await admin
      .from('responder_settings')
      .insert({ ...update, company_id: auth.company_id })
      .select()
      .single()
  }

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
  return NextResponse.json({ settings: result.data })
}
