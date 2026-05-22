import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

async function requireAdmin() {
  const check = await requireAdminArea('people')
  return check.ok && check.user ? { id: check.user.id, email: check.user.email } : null
}

export async function GET() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: rows, error } = await admin.rpc('get_admin_users')
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
    const profileUpdates: Record<string, string> = { invite_sent_at: new Date().toISOString() }
    if (full_name) profileUpdates.full_name = full_name
    await admin.from('user_profiles').update(profileUpdates).eq('id', data.user.id)

    if (display_name) {
      await admin.from('hub_users').update({ display_name }).eq('id', data.user.id)
    }
  }

  return NextResponse.json({ user: data.user })
}
