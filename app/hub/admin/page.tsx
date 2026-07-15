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

  // ALL roster rows (linked + unlinked, active + inactive) — the panel needs
  // them for the per-user Employee Roster toggle and the no-login section.
  const { data: employeeRows } = company?.company_id
    ? await admin
        .from('employees')
        .select('id, first_name, last_name, preferred_name, department, job_title, pay_type, hourly_rate, email, user_id, is_active')
        .eq('company_id', company.company_id)
    : { data: [] }

  const usersWithProfiles = (rows ?? []).map((r: {
    id: string; email: string; created_at: string; last_sign_in_at: string | null;
    role: string; can_access_routing: boolean; can_access_lawn: boolean;
    can_access_call_log: boolean; can_access_responder: boolean; can_access_timesheet: boolean;
    can_access_books: boolean; can_access_tracker: boolean; can_access_hub: boolean;
    can_access_fleet: boolean; can_access_zone_sizer: boolean;
    can_access_dialer: boolean; can_access_txt: boolean; can_access_unified_inbox: boolean; can_post_shout_outs: boolean;
    can_admin_people: boolean; can_admin_hub: boolean;
    can_admin_guardian: boolean; can_admin_ai: boolean; can_admin_txt: boolean; can_admin_announcements: boolean; can_admin_file_tags: boolean;
    can_admin_routing: boolean;
    can_admin_timesheet: boolean; can_admin_fleet: boolean; can_admin_daily_log: boolean;
    can_admin_zone_sizer: boolean; can_admin_dialer: boolean; can_admin_contacts: boolean; can_admin_integrations: boolean;
    can_access_marketing: boolean; can_admin_marketing: boolean;
    can_access_email: boolean; can_admin_email: boolean;
    can_access_forms: boolean; can_admin_forms: boolean; can_admin_products: boolean;
    can_access_daily_log_v2: boolean;
    can_access_call_log2: boolean; can_access_scoreboards: boolean;
    can_access_files: boolean; can_access_pesticide_records: boolean;
    can_access_pricer: boolean; can_access_coaching: boolean; can_access_beta: boolean;
    display_name: string | null; avatar_url: string | null; invite_sent_at: string | null;
    full_name: string | null;
    locked_at: string | null; deactivated_at: string | null;
  }) => ({
    id: r.id,
    email: r.email ?? '',
    created_at: r.created_at,
    last_sign_in_at: r.last_sign_in_at ?? null,
    full_name: r.full_name ?? null,
    display_name: r.display_name ?? null,
    avatar_url: r.avatar_url ?? null,
    invite_sent_at: r.invite_sent_at ?? null,
    locked_at: r.locked_at ?? null,
    deactivated_at: r.deactivated_at ?? null,
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
      can_access_txt: r.can_access_txt,
      can_access_unified_inbox: r.can_access_unified_inbox,
      can_post_shout_outs: r.can_post_shout_outs,
      can_admin_people: r.can_admin_people,
      can_admin_hub: r.can_admin_hub,
      can_admin_guardian: r.can_admin_guardian,
      can_admin_ai: r.can_admin_ai,
      can_admin_txt: r.can_admin_txt,
      can_admin_announcements: r.can_admin_announcements,
      can_admin_file_tags: r.can_admin_file_tags,
      can_admin_routing: r.can_admin_routing,
      can_admin_timesheet: r.can_admin_timesheet,
      can_admin_fleet: r.can_admin_fleet,
      can_admin_daily_log: r.can_admin_daily_log,
      can_admin_zone_sizer: r.can_admin_zone_sizer,
      can_admin_dialer: r.can_admin_dialer,
      can_admin_contacts: r.can_admin_contacts,
      can_admin_integrations: r.can_admin_integrations,
      can_access_marketing: r.can_access_marketing,
      can_admin_marketing: r.can_admin_marketing,
      can_access_email: r.can_access_email,
      can_admin_email: r.can_admin_email,
      can_access_forms: r.can_access_forms,
      can_admin_forms: r.can_admin_forms,
      can_admin_products: r.can_admin_products,
      can_access_daily_log_v2: r.can_access_daily_log_v2,
      can_access_call_log2: r.can_access_call_log2,
      can_access_scoreboards: r.can_access_scoreboards,
      can_access_files: r.can_access_files,
      can_access_pesticide_records: r.can_access_pesticide_records,
      can_access_pricer: r.can_access_pricer,
      can_access_coaching: r.can_access_coaching,
      can_access_beta: r.can_access_beta,
    },
  }))

  return <AdminPanel currentUserId={user.id} isSuperAdmin={isSuperAdmin} initialUsers={usersWithProfiles} initialEmployees={employeeRows ?? []} />
}
