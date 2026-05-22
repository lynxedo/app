import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AdminTabNav from '@/components/AdminTabNav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_people, can_admin_hub, can_admin_routing, can_admin_timesheet, can_admin_fleet, can_admin_daily_log')
    .eq('id', user.id)
    .single()

  const isSuperAdmin = profile?.role === 'admin'
  const hasAnyGrant = !!(
    profile && (
      profile.can_admin_people ||
      profile.can_admin_hub ||
      profile.can_admin_routing ||
      profile.can_admin_timesheet ||
      profile.can_admin_fleet ||
      profile.can_admin_daily_log
    )
  )
  if (!isSuperAdmin && !hasAnyGrant) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/hub" className="text-gray-400 hover:text-white text-sm transition-colors">
            ← Hub
          </Link>
          <span className="text-gray-600">|</span>
          <span className="text-xl font-bold tracking-tight">Admin</span>
        </div>
      </header>
      <div className="border-b border-gray-800 px-6">
        <AdminTabNav
          isSuperAdmin={isSuperAdmin}
          grants={{
            people: !!profile?.can_admin_people,
            hub: !!profile?.can_admin_hub,
            routing: !!profile?.can_admin_routing,
            timesheet: !!profile?.can_admin_timesheet,
            fleet: !!profile?.can_admin_fleet,
            daily_log: !!profile?.can_admin_daily_log,
          }}
        />
      </div>
      <main className="max-w-4xl mx-auto px-6 py-10">
        {children}
      </main>
    </div>
  )
}
