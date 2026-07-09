import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

// POST /api/admin/txt/number-access — replace a user's phone-number access set.
// Body: { user_id, phone_number_ids: string[] }
//
// Restriction model: an EMPTY array clears all rows → the user becomes
// unrestricted (sees every company number, in both Txt2 and Dialer). A non-empty
// array limits the user to exactly those numbers. Managers/admins bypass this in
// app code regardless of what's stored here.
export async function POST(request: Request) {
  const auth = await requireAdminArea('txt')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await request.json().catch(() => ({}))
  const userId = String(body.user_id || '')
  const requested: string[] = Array.isArray(body.phone_number_ids)
    ? body.phone_number_ids.map((x: unknown) => String(x))
    : []
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  const admin = createAdminClient()

  // The target user must belong to the caller's company.
  const { data: target } = await admin
    .from('user_profiles')
    .select('id, company_id')
    .eq('id', userId)
    .maybeSingle()
  if (!target || target.company_id !== auth.company_id) {
    return NextResponse.json({ error: 'User not in your company' }, { status: 404 })
  }

  // Keep only number ids that actually belong to this company (defends against
  // a stale/foreign id being posted from the client).
  let validIds: string[] = []
  if (requested.length > 0) {
    const { data: nums } = await admin
      .from('txt_phone_numbers')
      .select('id')
      .eq('company_id', auth.company_id)
      .in('id', requested)
    validIds = (nums || []).map((n) => n.id)
  }

  // Replace the user's access set: wipe then re-insert the valid selection.
  const { error: delErr } = await admin
    .from('user_phone_number_access')
    .delete()
    .eq('user_id', userId)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  if (validIds.length > 0) {
    const { error: insErr } = await admin
      .from('user_phone_number_access')
      .insert(validIds.map((phone_number_id) => ({ user_id: userId, phone_number_id })))
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, access_number_ids: validIds })
}
