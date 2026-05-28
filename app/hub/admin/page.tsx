import { redirect } from 'next/navigation'
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
    .select('role, can_admin_people')
    .eq('id', user.id)
    .single()
  const isSuperAdmin = profile?.role === 'admin'
  if (!isSuperAdmin && !profile?.can_admin_people) redirect('/dashboard')

  const admin = createAdminClient()

  const [{ data: rows }, { data: company }] = await Promise.all([
    admin.rpc('get_admin_users'),
    supabase.from('user_profiles').select('company_id').eq('id', user.id).single(),
  ])

  const { data: employeeRows } = company?.company_id
    ? await admin
        .from('employees')
        .select('id, first_name, last_name, preferred_name, department, job_title, pay_type, email, user_id')
        .eq('company_id', company.company_id)
        .eq('is_active', true)
        .is('user_id', null)
    : { data: [] }

  const usersWithProfiles = (rows ?? []).map((r: {
    id: string; email: string; created_at: string; last_sign_in_at: string | null;
    role: string; can_access_routing: boolean; can_access_lawn: boolean;
    can_access_call_log: boolean; can_access_responder: boolean; can_access_timesheet: boolean;
    can_access_books: boolean; can_access_tracker: boolean; can_access_hub: boolean;
    can_access_fleet: boolean; can_access_zone_sizer: boolean;
    can_access_dialer: boolean; can_post_shout_outs: boolean;
    can_admin_people: boolean; can_admin_hub: boolean; can_admin_routing: boolean;
    can_admin_timesheet: boolean; can_admin_fleet: boolean; can_admin_daily_log: boolean;
    can_admin_zone_sizer: boolean; can_admin_dialer: boolean; can_admin_contacts: boolean;
    can_access_marketing: boolean; can_admin_marketing: boolean;
    display_name: string | null; avatar_url: string | null; invite_sent_at: string | null;
    full_name: string | null;
  }) => ({
    id: r.id,
    email: r.email ?? '',
    created_at: r.created_at,
    last_sign_in_at: r.last_sign_in_at ?? null,
    full_name: r.full_name ?? null,
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
      can_access_fleet: r.can_access_fleet,
      can_access_zone_sizer: r.can_access_zone_sizer,
      can_access_dialer: r.can_access_dialer,
      can_post_shout_outs: r.can_post_shout_outs,
      can_admin_people: r.can_admin_people,
      can_admin_hub: r.can_admin_hub,
      can_admin_routing: r.can_admin_routing,
      can_admin_timesheet: r.can_admin_timesheet,
      can_admin_fleet: r.can_admin_fleet,
      can_admin_daily_log: r.can_admin_daily_log,
      can_admin_zone_sizer: r.can_admin_zone_sizer,
      can_admin_dialer: r.can_admin_dialer,
      can_admin_contacts: r.can_admin_contacts,
      can_access_marketing: r.can_access_marketing,
      can_admin_marketing: r.can_admin_marketing,
    },
  }))

  return <AdminPanel currentUserId={user.id} isSuperAdmin={isSuperAdmin} initialUsers={usersWithProfiles} initialEmployees={employeeRows ?? []} />
}
