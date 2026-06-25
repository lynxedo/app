import { redirect } from 'next/navigation'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import TxtAdminShell from './TxtAdminShell'

export default async function TxtAdminPage() {
  const auth = await requireAdminArea('txt')
  if (!auth.ok || !auth.company_id) {
    redirect('/hub/home')
  }

  const admin = createAdminClient()

  const [{ data: templates }, { data: numbers }, { data: settings }, { data: users }, { data: profiles }] = await Promise.all([
    admin
      .from('txt_templates')
      .select('id, scope, title, body, media, sort_order, owner_user_id, updated_at')
      .eq('company_id', auth.company_id)
      .eq('scope', 'org')
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true }),
    admin
      .from('txt_phone_numbers')
      .select('id, twilio_number, label, is_default, created_at')
      .eq('company_id', auth.company_id)
      .order('is_default', { ascending: false })
      .order('label', { ascending: true }),
    admin
      .from('txt_settings')
      .select('on_my_way_template, responder_notify_user_ids')
      .eq('company_id', auth.company_id)
      .maybeSingle(),
    admin
      .from('hub_users')
      .select('id, display_name')
      .eq('company_id', auth.company_id)
      .order('display_name', { ascending: true }),
    admin
      .from('user_profiles')
      .select('id, full_name, role, can_access_txt, can_admin_txt, can_assign_txt_threads')
      .eq('company_id', auth.company_id)
      .order('full_name', { ascending: true }),
  ])

  const settingsTyped = settings as { on_my_way_template?: string | null; responder_notify_user_ids?: string[] } | null

  // Texting Managers picker: list everyone with Txt2 access (or admin / Txt-admin,
  // who are managers regardless). Admins + Txt-admins are "always" managers.
  type ProfileRow = {
    id: string
    full_name: string | null
    role: string | null
    can_access_txt: boolean | null
    can_admin_txt: boolean | null
    can_assign_txt_threads: boolean | null
  }
  const profileRows = (profiles ?? []) as ProfileRow[]
  const managerUsers = profileRows
    .filter((p) => p.can_access_txt === true || p.role === 'admin' || p.can_admin_txt === true)
    .map((p) => ({
      id: p.id,
      display_name: p.full_name || 'Unnamed',
      always: p.role === 'admin' || p.can_admin_txt === true,
    }))
  const initialManagerIds = managerUsers
    .filter((u) => !u.always)
    .filter((u) => profileRows.find((p) => p.id === u.id)?.can_assign_txt_threads === true)
    .map((u) => u.id)

  return (
    <TxtAdminShell
      initialTemplates={templates || []}
      initialNumbers={numbers || []}
      initialOnMyWayTemplate={settingsTyped?.on_my_way_template ?? null}
      initialResponderNotifyIds={settingsTyped?.responder_notify_user_ids ?? []}
      initialManagerIds={initialManagerIds}
      managerUsers={managerUsers}
      users={users || []}
    />
  )
}
