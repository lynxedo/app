import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { toE164 } from '@/lib/twilio'

// GET /api/admin/txt/numbers — list all phone numbers for the caller's company.
export async function GET() {
  const auth = await requireAdminArea('txt')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('txt_phone_numbers')
    .select('id, twilio_number, label, is_default, created_at')
    .eq('company_id', auth.company_id)
    .order('is_default', { ascending: false })
    .order('label', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ numbers: data || [] })
}

// POST /api/admin/txt/numbers — create a new phone number.
// Body: { twilio_number, label?, is_default? }
export async function POST(request: Request) {
  const auth = await requireAdminArea('txt')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await request.json().catch(() => ({}))
  const e164 = toE164(String(body.twilio_number || ''))
  if (!e164) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
  }
  const label = body.label ? String(body.label).trim().slice(0, 80) : null
  const isDefault = body.is_default === true

  const admin = createAdminClient()
  // If marking default, demote any existing default first (partial-unique idx
  // enforces only one default per company; demotion keeps the write valid).
  if (isDefault) {
    await admin
      .from('txt_phone_numbers')
      .update({ is_default: false })
      .eq('company_id', auth.company_id)
      .eq('is_default', true)
  }

  const { data, error } = await admin
    .from('txt_phone_numbers')
    .insert({
      company_id: auth.company_id,
      twilio_number: e164,
      label,
      is_default: isDefault,
    })
    .select('id, twilio_number, label, is_default, created_at')
    .single()
  if (error) {
    return NextResponse.json(
      { error: error.message.includes('duplicate') ? 'This phone number is already added' : error.message },
      { status: 400 }
    )
  }
  return NextResponse.json({ number: data })
}
