import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminTabNav from '@/components/AdminTabNav'

// Rendered inside the Hub shell (parent app/hub/layout.tsx provides the rail
// and sidebar). We only render the AdminTabNav strip and the admin content —
// no separate header.
export default async function HubAdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_people, can_admin_hub, can_admin_routing, can_admin_timesheet, can_admin_fleet, can_admin_daily_log, can_admin_zone_sizer, can_admin_dialer, can_admin_contacts, can_admin_products')
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
      profile.can_admin_daily_log ||
      profile.can_admin_zone_sizer ||
      profile.can_admin_dialer ||
      profile.can_admin_contacts ||
      profile.can_admin_products
    )
  )
  if (!isSuperAdmin && !hasAnyGrant) redirect('/hub/home')

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <div className="border-b border-gray-800 px-4 md:px-6">
        <AdminTabNav
          isSuperAdmin={isSuperAdmin}
          grants={{
            people: !!profile?.can_admin_people,
            hub: !!profile?.can_admin_hub,
            routing: !!profile?.can_admin_routing,
            timesheet: !!profile?.can_admin_timesheet,
            fleet: !!profile?.can_admin_fleet,
            daily_log: !!profile?.can_admin_daily_log,
            zone_sizer: !!profile?.can_admin_zone_sizer,
            dialer: !!profile?.can_admin_dialer,
            contacts: !!profile?.can_admin_contacts,
            products: !!profile?.can_admin_products,
          }}
        />
      </div>
      <main className="max-w-4xl mx-auto px-4 md:px-6 py-6 md:py-10">
        {children}
      </main>
    </div>
  )
}
