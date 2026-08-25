import { redirect } from 'next/navigation'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getKnowledgeDocs, getGuardianSettings } from '@/lib/guardian-knowledge'
import { getAssistantPersona } from '@/lib/ai-persona'
import { DEFAULT_RECEPTIONIST_NAME, DEFAULT_TITLE_SERVICE_MAP, buildVoiceReceptionistPrompt, buildWelcomeGreeting } from '@/lib/voice-receptionist'
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
    persona,
  ] = await Promise.all([
    getKnowledgeDocs(admin, companyId),
    getGuardianSettings(admin, companyId),
    // People — who may use the assistant (hub_users.claude_allowed). Exclude
    // bots (the assistant bot itself is in hub_users with is_bot=true).
    admin
      .from('hub_users')
      .select('id, display_name, is_bot, claude_allowed')
      .eq('company_id', companyId)
      .order('display_name', { ascending: true }),
    // Rooms — where the assistant answers (rooms.claude_enabled). Sort: public
    // first, then private, alphabetical within each group.
    admin
      .from('rooms')
      .select('id, name, is_private, claude_enabled')
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
    // The shared AI-assistant persona — the one editable name + avatar worn by
    // BOTH bot rows (Hub bot + phone/text receptionist). See lib/ai-persona.ts.
    getAssistantPersona(admin, companyId),
  ])

  const people = (peopleResult.data ?? [])
    .filter((u: { is_bot: boolean | null }) => !u.is_bot)
    .map((u: { id: string; display_name: string | null; claude_allowed: boolean | null }) => ({
      id: u.id,
      display_name: u.display_name ?? '(no name)',
      claude_allowed: u.claude_allowed === true,
    }))

  const rooms = (roomsResult.data ?? []) as Array<{
    id: string
    name: string
    is_private: boolean
    claude_enabled: boolean
  }>

  // Assistant identity — the shared persona name + avatar. `id` is the row the
  // avatar is served from; the name is the resolved persona name (see
  // lib/ai-persona.ts), NOT the raw Hub-bot display_name, so this box always
  // shows the name customers actually hear and the team actually sees.
  const initialBot = {
    id: persona.primaryBotUserId,
    display_name: persona.name,
    avatar_url: persona.avatarUrl,
  }

  // AI Voice Receptionist — stored values for the form + code/env defaults used
  // as placeholders (and the resolved effective enabled state + level).
  const vrRow = (voiceReceptionistRow as VoiceReceptionistSettingsRow | null) ?? null
  const vrPlanMax = getPlanMaxReceptionistLevel(companyId)
  const vrEffective = resolveVoiceReceptionistSettings(vrRow, vrPlanMax)
  const initialVoiceReceptionist = {
    enabled: vrEffective.enabled,
    level: vrEffective.level,
    plan_max_level: vrPlanMax,
    // Read-only in the Receptionist panel — the name is edited once, in
    // Admin → AI → Assistant → Assistant identity (lib/ai-persona.ts), so the
    // spoken name and the in-Hub name can never drift apart.
    receptionist_name: persona.name,
    greeting_business_hours: vrRow?.greeting_business_hours ?? '',
    greeting_after_hours: vrRow?.greeting_after_hours ?? vrRow?.greeting ?? '',
    instructions: vrRow?.instructions ?? '',
    voice_id: vrRow?.voice_id ?? '',
    recap_text_enabled: vrEffective.recapTextEnabled,
    transfer_method: vrEffective.transferMethod,
    transfer_user_ids: vrEffective.transferUserIds,
    transfer_cell_numbers: vrEffective.transferCellNumbers,
    title_service_map: vrEffective.titleServiceMap,
    receptionist_name_default: DEFAULT_RECEPTIONIST_NAME,
    greeting_business_hours_default: buildWelcomeGreeting(vrEffective.effectiveLevel, {
      context: 'business_hours',
      name: vrEffective.receptionistName,
    }),
    greeting_after_hours_default: buildWelcomeGreeting(vrEffective.effectiveLevel, {
      context: 'after_hours',
      name: vrEffective.receptionistName,
    }),
    // canSchedule matters here too: "Reset to default" must load a template that
    // ALLOWS booking when the company is at Level 4/5 with scheduling on. Without
    // it, the one button an admin would reach for to fix a receptionist that won't
    // book hands them back the same prohibition that stopped her booking.
    instructions_default: buildVoiceReceptionistPrompt(vrEffective.effectiveLevel, {
      name: vrEffective.receptionistName,
      recapEnabled: vrEffective.recapTextEnabled,
      canSchedule: vrEffective.canSchedule,
    }),
    voice_id_default: process.env.VOICE_ELEVENLABS_VOICE_ID || '',
    title_service_map_default: DEFAULT_TITLE_SERVICE_MAP,
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
      initialBot={initialBot}
    />
  )
}
