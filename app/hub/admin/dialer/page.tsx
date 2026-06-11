import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import DialerAdminPanel from './DialerAdminPanel'
import type { IvrConfig } from './IvrEditor'
import type { ExtensionRow } from './ExtensionsPanel'
import type { RingGroup } from './RingGroupsPanel'

export const metadata = { title: 'Dialer Admin' }

const DEFAULTS = {
  inbound_route_user_id: null as string | null,
  ring_timeout_sec: 20,
  voicemail_recipient_user_ids: [] as string[],
  fallback_voicemail_url: null as string | null,
  ivr_enabled: false,
  ivr_config: { trees: {} } as IvrConfig,
  business_hours: {} as Record<string, unknown>,
  holidays: [] as unknown[],
}

export default async function AdminDialerPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_admin_dialer')
    .eq('id', user.id)
    .single()
  if ((profile?.role !== 'admin' && !profile?.can_admin_dialer) || !profile?.company_id) {
    redirect('/hub/home')
  }

  const admin = createAdminClient()
  const [
    { data: row },
    { data: hubUsersRaw },
    { data: extProfiles },
    { data: ringGroupRows },
    { data: ringMemberRows },
    { data: responderRow },
    { data: responderCalls },
  ] = await Promise.all([
    admin
      .from('dialer_settings')
      .select('*')
      .eq('company_id', profile.company_id)
      .maybeSingle(),
    admin
      .from('hub_users')
      .select('id, display_name')
      .eq('company_id', profile.company_id)
      .eq('is_bot', false)
      .order('display_name'),
    admin
      .from('user_profiles')
      .select('id, dialer_extension')
      .eq('company_id', profile.company_id),
    admin
      .from('dialer_ring_groups')
      .select('id, name, ring_mode, ring_timeout_sec')
      .eq('company_id', profile.company_id)
      .order('name'),
    admin
      .from('dialer_ring_group_members')
      .select('group_id, user_id, position, member_timeout_sec')
      .order('position'),
    admin
      .from('responder_settings')
      .select('*')
      .eq('company_id', profile.company_id)
      .maybeSingle(),
    admin
      .from('responder_calls')
      .select('id, call_sid, from_number, called_at, has_voicemail, text_sent, email_sent, template_used, error_message')
      .eq('company_id', profile.company_id)
      .order('called_at', { ascending: false })
      .limit(20),
  ])

  const settings = {
    ...DEFAULTS,
    ...(row ?? {}),
    voicemail_recipient_user_ids: row?.voicemail_recipient_user_ids ?? [],
    ivr_enabled: row?.ivr_enabled ?? false,
    ivr_config: (row?.ivr_config ?? { trees: {} }) as IvrConfig,
    business_hours: (row?.business_hours ?? {}) as Record<string, unknown>,
    holidays: (Array.isArray(row?.holidays) ? row!.holidays : []) as unknown[],
    recording_enabled: row?.recording_enabled ?? false,
    recording_consent_notice: row?.recording_consent_notice ?? '',
    recording_consent_enabled: row?.recording_consent_enabled !== false,
    recording_consent_url: row?.recording_consent_url ?? null,
    recording_pause_auto_resume_sec: row?.recording_pause_auto_resume_sec ?? 60,
    fallback_voicemail_tts: row?.fallback_voicemail_tts ?? '',
    disposition_options: Array.isArray(row?.disposition_options) ? (row!.disposition_options as string[]) : null,
  }

  // Build the extension grid (every hub_user + their current extension).
  const extByUser = new Map<string, string | null>()
  for (const p of extProfiles ?? []) extByUser.set(p.id, p.dialer_extension)
  const extensions: ExtensionRow[] = (hubUsersRaw ?? []).map((u) => ({
    user_id: u.id,
    display_name: u.display_name,
    extension: extByUser.get(u.id) ?? null,
  }))

  // Filter ring-group members down to this company's groups (since the
  // members fetch above didn't join on company_id — RLS would, but we use
  // the admin client; cheap filter by groupId set).
  const groupIdsInCompany = new Set((ringGroupRows ?? []).map((g) => g.id))
  const ringGroups: RingGroup[] = (ringGroupRows ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    ring_mode: g.ring_mode as 'simultaneous' | 'sequential',
    ring_timeout_sec: g.ring_timeout_sec,
    members: (ringMemberRows ?? [])
      .filter((m) => groupIdsInCompany.has(m.group_id) && m.group_id === g.id)
      .map((m) => ({
        user_id: m.user_id,
        position: m.position,
        member_timeout_sec: m.member_timeout_sec,
      })),
  }))

  return (
    <DialerAdminPanel
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initial={settings as any}
      hubUsers={hubUsersRaw ?? []}
      initialExtensions={extensions}
      initialRingGroups={ringGroups}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialResponder={responderRow as any ?? null}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialResponderCalls={(responderCalls ?? []) as any}
    />
  )
}
