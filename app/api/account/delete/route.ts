import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Self-service account deletion (App Store Guideline 5.1.1(v)).
// A signed-in user permanently deletes their OWN account: this removes their
// personal profile row and their auth login, then ends the session. It mirrors
// exactly what an admin does in Admin → People (app/api/admin/users/[id] DELETE),
// but is scoped to the caller — no admin privilege required, and a user can only
// ever delete themselves (we act on the authenticated user.id, never an input).
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Remove the personal profile row first, then the auth login. hub_users and
  // other auth.users-keyed rows cascade off the auth user deletion (same path
  // the admin removal relies on).
  await admin.from('user_profiles').delete().eq('id', user.id)

  const { error } = await admin.auth.admin.deleteUser(user.id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Clear the now-orphaned session cookie server-side. The client also signs
  // out and redirects to /login; this is belt-and-suspenders.
  try {
    await supabase.auth.signOut()
  } catch {
    // Session is already invalid now that the auth user is gone — ignore.
  }

  return NextResponse.json({ success: true })
}
