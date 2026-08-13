import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/twilio'
import { blockDigits } from '@/lib/blocked-numbers'

// Blocked callers.
//
//   GET    /api/dialer/blocked-numbers            → the company's block list
//   POST   /api/dialer/blocked-numbers            → block a number
//   DELETE /api/dialer/blocked-numbers?phone=…    → unblock
//
// Gated on can_access_dialer (admins included). Deliberately NOT admin-only:
// the person who takes the harassing call is the one who should be able to stop
// it, and Heroes has one office manager. Every row records WHO blocked it and
// when, and unblocking is one click — the audit trail plus a cheap undo is the
// safer trade than a gate that makes people wait for an admin.
//
// The table is service-role only (RLS on, no policies), so this route is the
// only way in and the gate above is the real boundary.

async function gate() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized', status: 401 as const }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_dialer, can_admin_dialer, role, company_id')
    .eq('id', user.id)
    .single()

  const allowed =
    profile?.role === 'admin' || profile?.can_access_dialer === true || profile?.can_admin_dialer === true
  if (!allowed) return { error: 'forbidden', status: 403 as const }
  if (!profile?.company_id) return { error: 'no company', status: 403 as const }
  return { user, companyId: profile.company_id as string }
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return NextResponse.json({ error: g.error }, { status: g.status })

  const admin = createAdminClient()
  const { data } = await admin
    .from('blocked_numbers')
    .select('id, phone, phone_digits, reason, blocks_calls, blocks_texts, created_at, created_by')
    .eq('company_id', g.companyId)
    .order('created_at', { ascending: false })

  const rows = data ?? []
  // Resolve who blocked each one — an audit trail nobody can read is not one.
  const ids = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[]
  const nameById: Record<string, string> = {}
  if (ids.length) {
    const { data: users } = await admin.from('hub_users').select('id, display_name').in('id', ids)
    for (const u of users ?? []) nameById[u.id as string] = (u.display_name as string) || ''
  }

  return NextResponse.json({
    blocked: rows.map((r) => ({ ...r, blocked_by_name: r.created_by ? nameById[r.created_by] || null : null })),
  })
}

export async function POST(request: Request) {
  const g = await gate()
  if ('error' in g) return NextResponse.json({ error: g.error }, { status: g.status })

  const body = await request.json().catch(() => ({}))
  const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : ''
  const digits = blockDigits(rawPhone)
  if (digits.length < 10) {
    return NextResponse.json({ error: 'A full phone number is required' }, { status: 400 })
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null
  // Default to blocking both. Blocking calls but leaving texts open is a real
  // choice (a customer who won't stop calling but texts fine), so it's offered —
  // it just isn't the default, because "block" plainly means both.
  const blocksCalls = body.blocks_calls !== false
  const blocksTexts = body.blocks_texts !== false
  if (!blocksCalls && !blocksTexts) {
    return NextResponse.json({ error: 'Block calls, texts, or both' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('blocked_numbers')
    .upsert(
      {
        company_id: g.companyId,
        phone_digits: digits,
        phone: toE164(rawPhone) || rawPhone,
        reason,
        blocks_calls: blocksCalls,
        blocks_texts: blocksTexts,
        created_by: g.user.id,
      },
      { onConflict: 'company_id,phone_digits' },
    )
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data?.id ?? null })
}

export async function DELETE(request: Request) {
  const g = await gate()
  if ('error' in g) return NextResponse.json({ error: g.error }, { status: g.status })

  const { searchParams } = new URL(request.url)
  const digits = blockDigits(searchParams.get('phone') || '')
  if (digits.length < 10) return NextResponse.json({ error: 'phone required' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('blocked_numbers')
    .delete()
    .eq('company_id', g.companyId)
    .eq('phone_digits', digits)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
