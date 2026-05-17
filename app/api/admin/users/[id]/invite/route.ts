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

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const admin = createAdminClient()

  // Look up the user's email
  const { data: { user }, error: lookupError } = await admin.auth.admin.getUserById(id)
  if (lookupError || !user?.email) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Re-invite — Supabase resends the email to an existing unconfirmed user
  const { error } = await admin.auth.admin.inviteUserByEmail(user.email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Mark invite as sent
  await admin
    .from('user_profiles')
    .update({ invite_sent_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
