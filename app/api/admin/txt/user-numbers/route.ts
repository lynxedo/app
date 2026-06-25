import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

// GET /api/admin/txt/user-numbers — list every hub user in the company along
// with their currently-assigned default Txt phone number (if any). Used to
// render the per-user default-number assignment grid in the Numbers tab.
export async function GET() {
  const auth = await requireAdminArea('hub')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  // Two-query join. user_profiles.id and hub_users.id both reference
  // auth.users.id but there's no direct FK between the two, so PostgREST
  // embeds aren't an option.
  const [{ data: profiles, error: pErr }, { data: hubUsers, error: hErr }, { data: access }] =
    await Promise.all([
      admin
        .from('user_profiles')
        .select('id, txt_default_number_id')
        .eq('company_id', auth.company_id),
      admin
        .from('hub_users')
        .select('id, display_name, is_bot')
        .eq('company_id', auth.company_id),
      // Per-user number-access scope (empty for a user = unrestricted/all).
      admin.from('user_phone_number_access').select('user_id, phone_number_id'),
    ])
  if (pErr || hErr) {
    return NextResponse.json({ error: (pErr || hErr)?.message }, { status: 500 })
  }

  // Group access rows by user → list of granted phone_number_ids.
  const accessByUser = new Map<string, string[]>()
  for (const row of access || []) {
    const list = accessByUser.get(row.user_id) || []
    list.push(row.phone_number_id)
    accessByUser.set(row.user_id, list)
  }

  const hubById = new Map((hubUsers || []).map((h) => [h.id, h]))
  const rows = (profiles || [])
    .map((p) => {
      const h = hubById.get(p.id)
      return {
        user_id: p.id,
        display_name: h?.display_name || null,
        is_bot: !!h?.is_bot,
        txt_default_number_id: p.txt_default_number_id || null,
        // [] = unrestricted (sees all numbers); non-empty = limited to these.
        access_number_ids: accessByUser.get(p.id) || [],
      }
    })
    .filter((r) => r.display_name && !r.is_bot)
    .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))

  return NextResponse.json({ users: rows })
}

// POST /api/admin/txt/user-numbers — set/clear a user's default Txt number.
// Body: { user_id, phone_number_id | null }
export async function POST(request: Request) {
  const auth = await requireAdminArea('hub')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await request.json().catch(() => ({}))
  const userId = String(body.user_id || '')
  const phoneNumberId: string | null = body.phone_number_id ? String(body.phone_number_id) : null
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  const admin = createAdminClient()

  // Verify the user belongs to the caller's company.
  const { data: target } = await admin
    .from('user_profiles')
    .select('id, company_id')
    .eq('id', userId)
    .maybeSingle()
  if (!target || target.company_id !== auth.company_id) {
    return NextResponse.json({ error: 'User not in your company' }, { status: 404 })
  }

  // Verify the number belongs to the same company too (if assigning one).
  if (phoneNumberId) {
    const { data: num } = await admin
      .from('txt_phone_numbers')
      .select('id, company_id')
      .eq('id', phoneNumberId)
      .maybeSingle()
    if (!num || num.company_id !== auth.company_id) {
      return NextResponse.json({ error: 'Phone number not in your company' }, { status: 400 })
    }
  }

  const { error } = await admin
    .from('user_profiles')
    .update({ txt_default_number_id: phoneNumberId })
    .eq('id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
