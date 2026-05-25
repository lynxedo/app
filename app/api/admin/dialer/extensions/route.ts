import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

// GET /api/admin/dialer/extensions
// Returns every user in the company with their current extension (null if unassigned).
export async function GET() {
  const check = await requireAdminArea('dialer')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const admin = createAdminClient()
  const [{ data: profiles }, { data: hubUsers }] = await Promise.all([
    admin
      .from('user_profiles')
      .select('id, dialer_extension')
      .eq('company_id', check.company_id),
    admin
      .from('hub_users')
      .select('id, display_name')
      .eq('company_id', check.company_id)
      .eq('is_bot', false)
      .order('display_name'),
  ])
  const extByUser = new Map<string, string | null>()
  for (const p of profiles ?? []) extByUser.set(p.id, p.dialer_extension)

  const rows = (hubUsers ?? []).map((u) => ({
    user_id: u.id,
    display_name: u.display_name,
    extension: extByUser.get(u.id) ?? null,
  }))
  return NextResponse.json({ rows })
}

// POST /api/admin/dialer/extensions
// Body: { user_id: string, extension: string | null }
// Set or clear one user's extension. Server-side validates 100-999 format +
// company-scoped uniqueness (CHECK + partial unique index also enforce DB-side).
export async function POST(request: NextRequest) {
  const check = await requireAdminArea('dialer')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const body = await request.json().catch(() => null)
  const userId = typeof body?.user_id === 'string' ? body.user_id : null
  const extRaw = body?.extension
  const extension =
    extRaw === null || extRaw === ''
      ? null
      : typeof extRaw === 'string' && /^[1-9][0-9]{2}$/.test(extRaw)
        ? extRaw
        : 'invalid'
  if (!userId) {
    return NextResponse.json({ error: 'user_id_required' }, { status: 400 })
  }
  if (extension === 'invalid') {
    return NextResponse.json({ error: 'extension_must_be_three_digits_100_to_999' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Verify the target user is in this company.
  const { data: target } = await admin
    .from('user_profiles')
    .select('id, company_id')
    .eq('id', userId)
    .maybeSingle()
  if (!target || target.company_id !== check.company_id) {
    return NextResponse.json({ error: 'user_not_in_company' }, { status: 404 })
  }

  // If assigning, verify uniqueness within the company (defense in depth — DB
  // index will also error, but this returns a friendlier message).
  if (extension !== null) {
    const { data: conflict } = await admin
      .from('user_profiles')
      .select('id')
      .eq('company_id', check.company_id)
      .eq('dialer_extension', extension)
      .neq('id', userId)
      .maybeSingle()
    if (conflict) {
      return NextResponse.json({ error: 'extension_in_use' }, { status: 409 })
    }
  }

  const { error: updErr } = await admin
    .from('user_profiles')
    .update({ dialer_extension: extension })
    .eq('id', userId)
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, user_id: userId, extension })
}
