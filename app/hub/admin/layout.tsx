import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Rendered inside the Hub shell (parent app/hub/layout.tsx provides the rail
// and the Admin sidebar, which is now the single cross-section navigation).
// This layout only enforces the admin permission gate and wraps the content —
// the old cross-section AdminTabNav was removed in favor of the sidebar. Each
// section's own sub-tabs (e.g. Hub's rooms/members/settings) still render as a
// top bar inside their own panel.
export default async function HubAdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_people, can_admin_hub, can_admin_guardian, can_admin_ai, can_admin_txt, can_admin_announcements, can_admin_file_tags, can_admin_routing, can_admin_timesheet, can_admin_fleet, can_admin_daily_log, can_admin_zone_sizer, can_admin_dialer, can_admin_contacts, can_admin_products, can_admin_integrations')
    .eq('id', user.id)
    .single()

  const isSuperAdmin = profile?.role === 'admin'
  const hasAnyGrant = !!(
    profile && (
      profile.can_admin_people ||
      profile.can_admin_hub ||
      profile.can_admin_guardian ||
      profile.can_admin_ai ||
      profile.can_admin_txt ||
      profile.can_admin_announcements ||
      profile.can_admin_file_tags ||
      profile.can_admin_routing ||
      profile.can_admin_timesheet ||
      profile.can_admin_fleet ||
      profile.can_admin_daily_log ||
      profile.can_admin_zone_sizer ||
      profile.can_admin_dialer ||
      profile.can_admin_contacts ||
      profile.can_admin_products ||
      profile.can_admin_integrations
    )
  )
  if (!isSuperAdmin && !hasAnyGrant) redirect('/hub/home')

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <main className="max-w-4xl mx-auto px-4 md:px-6 py-6 md:py-10">
        {children}
      </main>
    </div>
  )
}
