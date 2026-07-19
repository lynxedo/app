import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

async function requireAdmin() {
  const check = await requireAdminArea('people')
  return check.ok && check.user
    ? { id: check.user.id, email: check.user.email, company_id: check.company_id }
    : null
}

// Ensure an invited user has a profile + Hub identity in the admin's company.
// The on-signup trigger only auto-provisions emails that match the company's
// Google domain, so invites to any other address (personal Gmail, etc.) would
// otherwise land with no profile and be invisible everywhere. ignoreDuplicates
// leaves a domain user's trigger-created row untouched.
async function ensureProvisioned(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  companyId: string | null,
  email: string,
  fullName?: string,
  displayName?: string,
) {
  if (!companyId) return
  await admin.from('user_profiles').upsert(
    {
      id: userId,
      company_id: companyId,
      role: 'user',
      can_access_routing: false,
      can_access_lawn: false,
      can_access_call_log: false,
      can_access_responder: false,
      can_access_timesheet: false,
      can_access_books: false,
      can_access_tracker: false,
      can_access_hub: true,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  )
  await admin.from('hub_users').upsert(
    {
      id: userId,
      company_id: companyId,
      display_name: displayName || fullName || email.split('@')[0],
    },
    { onConflict: 'id', ignoreDuplicates: true },
  )
}

export async function GET() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Track 1 — the service-role RPC below is company-blind; a caller with no company gets nothing.
  if (!user.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  // get_admin_users(p_company_id) filters to the caller's company at the source
  // (SECURITY DEFINER), so cross-company users can never leak into the result.
  const { data: rows, error } = await admin.rpc('get_admin_users', { p_company_id: user.company_id })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    users: (rows ?? []).map((r: {
      id: string; email: string; created_at: string; last_sign_in_at: string | null;
      role: string; can_access_routing: boolean; can_access_lawn: boolean;
      can_access_call_log: boolean; can_access_responder: boolean; can_access_timesheet: boolean;
      can_access_books: boolean; can_access_tracker: boolean; can_access_hub: boolean;
      can_post_shout_outs: boolean;
      display_name: string | null; avatar_url: string | null; invite_sent_at: string | null;
      phone: string | null;
    }) => ({
      id: r.id,
      email: r.email ?? '',
      created_at: r.created_at,
      last_sign_in_at: r.last_sign_in_at ?? null,
      display_name: r.display_name ?? null,
      avatar_url: r.avatar_url ?? null,
      invite_sent_at: r.invite_sent_at ?? null,
      profile: {
        id: r.id,
        role: r.role,
        can_access_routing: r.can_access_routing,
        can_access_lawn: r.can_access_lawn,
        can_access_call_log: r.can_access_call_log,
        can_access_responder: r.can_access_responder,
        can_access_timesheet: r.can_access_timesheet,
        can_access_books: r.can_access_books,
        can_access_tracker: r.can_access_tracker,
        can_access_hub: r.can_access_hub,
        can_post_shout_outs: r.can_post_shout_outs,
      },
    })),
  })
}

export async function POST(request: Request) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Track 1 — without a company, ensureProvisioned would silently no-op and leave an
  // orphaned companyless auth user; refuse instead.
  if (!adminUser.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email, full_name, display_name, deferred } = await request.json()
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  const admin = createAdminClient()

  if (deferred) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: false,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (data.user) {
      await ensureProvisioned(admin, data.user.id, adminUser.company_id, email, full_name, display_name)
      if (full_name) {
        await admin.from('user_profiles').update({ full_name }).eq('id', data.user.id)
      }
      if (display_name) {
        await admin.from('hub_users').update({ display_name }).eq('id', data.user.id)
      }
    }

    return NextResponse.json({ user: data.user, deferred: true })
  }

  // Standard invite — send magic link email immediately
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (data.user) {
    await ensureProvisioned(admin, data.user.id, adminUser.company_id, email, full_name, display_name)
    const profileUpdates: Record<string, string> = { invite_sent_at: new Date().toISOString() }
    if (full_name) profileUpdates.full_name = full_name
    await admin.from('user_profiles').update(profileUpdates).eq('id', data.user.id)

    if (display_name) {
      await admin.from('hub_users').update({ display_name }).eq('id', data.user.id)
    }
  }

  return NextResponse.json({ user: data.user })
}
