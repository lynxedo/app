import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  return profile?.role === 'admin' ? user : null
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
    }) => ({
      id: r.id,
      email: r.email ?? '',
      created_at: r.created_at,
      last_sign_in_at: r.last_sign_in_at ?? null,
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
      },
    })),
  })
}

export async function POST(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email } = await request.json()
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ user: data.user })
}
