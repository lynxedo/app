import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import AdminPanel from './AdminPanel'

export const metadata = { title: 'Admin' }

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
  const { data: rows } = await admin.rpc('get_admin_users')


  const usersWithProfiles = (rows ?? []).map((r: {
    id: string; email: string; created_at: string; last_sign_in_at: string | null;
    role: string; can_access_routing: boolean; can_access_lawn: boolean;
    can_access_call_log: boolean; can_access_responder: boolean; can_access_timesheet: boolean;
    can_access_books: boolean; can_access_tracker: boolean; can_access_hub: boolean;
    display_name: string | null; avatar_url: string | null; invite_sent_at: string | null;
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
    },
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
          <Link
            href="/admin/hub"
            className="bg-gray-900 border border-gray-800 hover:border-[#2E7EB8]/50 rounded-xl px-4 py-3 text-sm transition-colors group"
          >
            <span className="mr-2">💬</span>
            <span className="font-medium">Hub Admin</span>
            <span className="text-gray-600 group-hover:text-[#2E7EB8] ml-2 transition-colors">→</span>
          </Link>
        </div>
        <AdminPanel currentUserId={user.id} initialUsers={usersWithProfiles} />
      </main>
    </div>
  )
}
