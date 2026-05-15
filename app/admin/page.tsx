import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import AdminPanel from './AdminPanel'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/dashboard')

  const admin = createAdminClient()
  const { data: listData, error: listError } = await admin.auth.admin.listUsers()
  const { data: profiles } = await admin.from('user_profiles').select('*')

  const profileMap = new Map(profiles?.map(p => [p.id, p]) ?? [])
  const allUsers = listData?.users ?? []

  // Exclude bot/system accounts (no user_profiles row) from the admin UI
  const usersWithProfiles = allUsers
    .filter(u => profileMap.has(u.id))
    .map(u => ({
      id: u.id,
      email: u.email ?? '',
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      profile: profileMap.get(u.id) ?? null,
    }))

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-gray-400 hover:text-white text-sm transition-colors">
            ← Dashboard
          </Link>
          <span className="text-gray-600">|</span>
          <span className="text-xl font-bold tracking-tight">User Management</span>
        </div>
        <Link href="/help" className="text-gray-400 hover:text-white transition-colors text-lg leading-none font-bold" title="Help">
          ?
        </Link>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex gap-3 mb-8">
          <Link
            href="/admin/timesheet"
            className="bg-gray-900 border border-gray-800 hover:border-yellow-500/50 rounded-xl px-4 py-3 text-sm transition-colors group"
          >
            <span className="mr-2">🕐</span>
            <span className="font-medium">Timesheet Admin</span>
            <span className="text-gray-600 group-hover:text-yellow-500 ml-2 transition-colors">→</span>
          </Link>
        </div>
        <AdminPanel currentUserId={user.id} initialUsers={usersWithProfiles} />
      </main>
    </div>
  )
}
