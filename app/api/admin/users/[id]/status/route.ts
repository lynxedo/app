import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { setAuthBan, clearPushTokens, transferTxtConversations } from '@/lib/user-offboarding'

// Two-layer offboarding:
//   lock       — sign-in blocked (security), still visible in People + roster
//   deactivate — archived: hidden behind the Deactivated filter, roster row
//                inactive, Txt conversations transferred to the main admin
//   unlock / reactivate — reverse the above (access toggles are untouched)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = await requireAdminArea('people')
  if (!check.ok || !check.user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Track 1 — the admin client below bypasses RLS; a caller with no company can't manage anyone.
  if (!check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { action } = await request.json()
  if (!['lock', 'unlock', 'deactivate', 'reactivate'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }
  if (id === check.user.id) {
    return NextResponse.json({ error: 'You cannot lock or deactivate your own account' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: target } = await admin
    .from('user_profiles')
    .select('id, role, locked_at, deactivated_at, company_id')
    .eq('id', id)
    .single()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  // Track 1 — cross-company target: answer exactly like a missing user (don't leak existence).
  if (target.company_id !== check.company_id) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }
  if (target.role === 'admin' && !check.isSuperAdmin) {
    return NextResponse.json({ error: 'Only full admins can lock or deactivate an admin' }, { status: 403 })
  }

  const now = new Date().toISOString()
  let transferred = 0

  try {
    if (action === 'lock') {
      await setAuthBan(admin, id, true)
      await clearPushTokens(admin, id)
      await admin.from('user_profiles').update({ locked_at: now, updated_at: now }).eq('id', id)
    } else if (action === 'unlock') {
      if (target.deactivated_at) {
        return NextResponse.json({ error: 'This person is deactivated — use Reactivate' }, { status: 400 })
      }
      await setAuthBan(admin, id, false)
      await admin.from('user_profiles').update({ locked_at: null, updated_at: now }).eq('id', id)
    } else if (action === 'deactivate') {
      await setAuthBan(admin, id, true)
      await clearPushTokens(admin, id)
      transferred = await transferTxtConversations(admin, id, check.user.id)
      await admin
        .from('employees')
        .update({ is_active: false, updated_at: now })
        .eq('user_id', id)
      await admin
        .from('user_profiles')
        .update({ deactivated_at: now, locked_at: target.locked_at ?? now, updated_at: now })
        .eq('id', id)
    } else {
      // reactivate — restores sign-in; access toggles and roster membership are
      // deliberately NOT restored (the admin re-grants what still applies)
      await setAuthBan(admin, id, false)
      await admin
        .from('user_profiles')
        .update({ deactivated_at: null, locked_at: null, updated_at: now })
        .eq('id', id)
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Action failed' }, { status: 500 })
  }

  const { data: profile } = await admin
    .from('user_profiles')
    .select('locked_at, deactivated_at')
    .eq('id', id)
    .single()

  return NextResponse.json({
    ok: true,
    locked_at: profile?.locked_at ?? null,
    deactivated_at: profile?.deactivated_at ?? null,
    txt_conversations_transferred: transferred,
  })
}
