import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getKnowledgeDocs, getGuardianSettings } from '@/lib/guardian-knowledge'
import GuardianAdminPanel from './GuardianAdminPanel'

export const metadata = { title: 'Guardian Admin' }
export const dynamic = 'force-dynamic'

export default async function AdminGuardianPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_admin_hub')
    .eq('id', user.id)
    .single()

  const isSuperAdmin = profile?.role === 'admin'
  if ((!isSuperAdmin && !profile?.can_admin_hub) || !profile?.company_id) redirect('/hub/home')

  const admin = createAdminClient()
  const companyId = profile.company_id

  const [docs, settings, peopleResult, roomsResult] = await Promise.all([
    getKnowledgeDocs(admin, companyId),
    getGuardianSettings(admin, companyId),
    // People — hub_users + user_profiles join. Exclude bots (the @Guardian
    // bot itself is in hub_users with is_bot=true).
    admin
      .from('hub_users')
      .select('id, display_name, is_bot')
      .eq('company_id', companyId)
      .order('display_name', { ascending: true }),
    // Rooms — all rooms in the company. Sort: public first, then private,
    // alphabetical within each group.
    admin
      .from('rooms')
      .select('id, name, is_private, guardian_full_access')
      .eq('company_id', companyId)
      .order('is_private', { ascending: true })
      .order('name', { ascending: true }),
  ])

  // Pull the guardian_tier values for the same set of users in one batched query.
  const userIds = (peopleResult.data ?? [])
    .filter((u: { is_bot: boolean | null }) => !u.is_bot)
    .map((u: { id: string }) => u.id)

  const { data: profiles } = userIds.length > 0
    ? await admin
        .from('user_profiles')
        .select('id, guardian_tier')
        .in('id', userIds)
    : { data: [] }

  const tierByUser: Record<string, string> = {}
  for (const p of (profiles ?? []) as Array<{ id: string; guardian_tier: string }>) {
    tierByUser[p.id] = p.guardian_tier
  }

  const people = (peopleResult.data ?? [])
    .filter((u: { is_bot: boolean | null }) => !u.is_bot)
    .map((u: { id: string; display_name: string | null }) => ({
      id: u.id,
      display_name: u.display_name ?? '(no name)',
      guardian_tier: tierByUser[u.id] ?? 'basic',
    }))

  const rooms = (roomsResult.data ?? []) as Array<{
    id: string
    name: string
    is_private: boolean
    guardian_full_access: boolean
  }>

  return (
    <GuardianAdminPanel
      initialDocs={docs}
      initialSettings={settings}
      initialPeople={people}
      initialRooms={rooms}
      isSuperAdmin={isSuperAdmin}
    />
  )
}
