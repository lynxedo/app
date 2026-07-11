import { redirect } from 'next/navigation'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getKnowledgeDocs, getGuardianSettings } from '@/lib/guardian-knowledge'
import { DEFAULT_RECEPTIONIST_NAME, buildVoiceReceptionistPrompt, buildWelcomeGreeting } from '@/lib/voice-receptionist'
import {
  VOICE_RECEPTIONIST_COLUMNS,
  getPlanMaxReceptionistLevel,
  resolveVoiceReceptionistSettings,
  type VoiceReceptionistSettingsRow,
} from '@/lib/voice-receptionist-settings'
import AiAdminShell from './AiAdminShell'

export const metadata = { title: 'AI Admin' }
export const dynamic = 'force-dynamic'

export default async function AdminAiPage() {
  const auth = await requireAdminArea('ai')
  if (!auth.ok || !auth.company_id) {
    redirect('/hub/home')
  }

  const admin = createAdminClient()
  const companyId = auth.company_id

  const [
    docs,
    settings,
    peopleResult,
    roomsResult,
    { data: responderRow },
    { data: responderCalls },
    { data: voiceReceptionistRow },
  ] = await Promise.all([
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
    admin
      .from('responder_settings')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle(),
    admin
      .from('responder_calls')
      .select('id, call_sid, from_number, called_at, has_voicemail, text_sent, email_sent, template_used, error_message')
      .eq('company_id', companyId)
      .order('called_at', { ascending: false })
      .limit(20),
    admin
      .from('voice_receptionist_settings')
      .select(VOICE_RECEPTIONIST_COLUMNS)
      .eq('company_id', companyId)
      .maybeSingle(),
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

  // AI Voice Receptionist — stored values for the form + code/env defaults used
  // as placeholders (and the resolved effective enabled state + level).
  const vrRow = (voiceReceptionistRow as VoiceReceptionistSettingsRow | null) ?? null
  const vrPlanMax = getPlanMaxReceptionistLevel(companyId)
  const vrEffective = resolveVoiceReceptionistSettings(vrRow, vrPlanMax)
  const initialVoiceReceptionist = {
    enabled: vrEffective.enabled,
    level: vrEffective.level,
    plan_max_level: vrPlanMax,
    receptionist_name: vrRow?.receptionist_name ?? '',
    greeting_business_hours: vrRow?.greeting_business_hours ?? '',
    greeting_after_hours: vrRow?.greeting_after_hours ?? vrRow?.greeting ?? '',
    instructions: vrRow?.instructions ?? '',
    voice_id: vrRow?.voice_id ?? '',
    recap_text_enabled: vrEffective.recapTextEnabled,
    transfer_method: vrEffective.transferMethod,
    transfer_user_ids: vrEffective.transferUserIds,
    receptionist_name_default: DEFAULT_RECEPTIONIST_NAME,
    greeting_business_hours_default: buildWelcomeGreeting(vrEffective.effectiveLevel, {
      context: 'business_hours',
      name: vrEffective.receptionistName,
    }),
    greeting_after_hours_default: buildWelcomeGreeting(vrEffective.effectiveLevel, {
      context: 'after_hours',
      name: vrEffective.receptionistName,
    }),
    instructions_default: buildVoiceReceptionistPrompt(vrEffective.effectiveLevel, {
      name: vrEffective.receptionistName,
      recapEnabled: vrEffective.recapTextEnabled,
    }),
    voice_id_default: process.env.VOICE_ELEVENLABS_VOICE_ID || '',
  }

  return (
    <AiAdminShell
      isSuperAdmin={auth.isSuperAdmin}
      initialSettings={settings}
      initialPeople={people}
      initialRooms={rooms}
      initialDocs={docs}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialResponder={responderRow as any ?? null}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialResponderCalls={(responderCalls ?? []) as any}
      initialVoiceReceptionist={initialVoiceReceptionist}
    />
  )
}
