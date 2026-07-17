'use client'

import { useState } from 'react'
import GuardianPanel from './GuardianPanel'
import ResponderPanel from './ResponderPanel'
import ReceptionistPanel from './ReceptionistPanel'
import SchedulingPanel from './SchedulingPanel'
import RoutingPanel from './RoutingPanel'
import KnowledgePanel from './KnowledgePanel'
import { type ResponderSettings, type ResponderCall } from '@/lib/responder'

type Settings = {
  model: string
  web_search_daily_cap: number
}

type Person = {
  id: string
  display_name: string
  guardian_tier: string
}

type Room = {
  id: string
  name: string
  is_private: boolean
  guardian_full_access: boolean
}

type Doc = {
  id: string
  company_id: string
  slug: string
  title: string
  body: string
  always_include: boolean
  audiences: string[]
  created_at: string
  updated_at: string
  updated_by: string | null
}

type VoiceReceptionistInitial = {
  enabled: boolean
  level: number
  plan_max_level: number
  receptionist_name: string
  greeting_business_hours: string
  greeting_after_hours: string
  instructions: string
  voice_id: string
  recap_text_enabled: boolean
  transfer_method: string
  transfer_user_ids: string[]
  transfer_cell_numbers: Record<string, string>
  title_service_map: { match: string; say: string }[]
  receptionist_name_default: string
  greeting_business_hours_default: string
  greeting_after_hours_default: string
  instructions_default: string
  voice_id_default: string
  title_service_map_default: { match: string; say: string }[]
}

type SubTab = 'guardian' | 'responder' | 'receptionist' | 'knowledge'

type BotIdentity = {
  id: string
  display_name: string
  avatar_url: string | null
}

export default function AiAdminShell({
  isSuperAdmin,
  initialSettings,
  initialPeople,
  initialRooms,
  initialDocs,
  initialResponder,
  initialResponderCalls,
  initialVoiceReceptionist,
  initialBot,
}: {
  isSuperAdmin: boolean
  initialSettings: Settings
  initialPeople: Person[]
  initialRooms: Room[]
  initialDocs: Doc[]
  initialResponder: Omit<ResponderSettings, 'id' | 'company_id'> | null
  initialResponderCalls: ResponderCall[]
  initialVoiceReceptionist: VoiceReceptionistInitial
  initialBot: BotIdentity
}) {
  const [tab, setTab] = useState<SubTab>('guardian')
  // Track the receptionist's selected level so we show only the settings that
  // level uses: Scheduling appears at Level 4+, Call routing at Level 5. Seeded
  // from the saved level; ReceptionistPanel reports changes as the admin picks.
  const [rxLevel, setRxLevel] = useState<number>(initialVoiceReceptionist.level)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">AI</h1>
        <p className="text-sm text-white/60 mt-1">
          The Hub Bot, the auto-text responder, the AI voice receptionist, and the shared knowledge base.
        </p>
      </header>

      <div className="flex gap-1 border-b border-gray-800 flex-wrap">
        <SubTabButton active={tab === 'guardian'} onClick={() => setTab('guardian')}>
          Hub Bot
        </SubTabButton>
        <SubTabButton active={tab === 'responder'} onClick={() => setTab('responder')}>
          Auto Responder
        </SubTabButton>
        <SubTabButton active={tab === 'receptionist'} onClick={() => setTab('receptionist')}>
          AI Receptionist
        </SubTabButton>
        <SubTabButton active={tab === 'knowledge'} onClick={() => setTab('knowledge')}>
          Knowledge
        </SubTabButton>
      </div>

      {tab === 'guardian' && (
        <GuardianPanel
          initialSettings={initialSettings}
          initialPeople={initialPeople}
          initialRooms={initialRooms}
          isSuperAdmin={isSuperAdmin}
          botId={initialBot.id}
          initialBotName={initialBot.display_name}
          initialBotAvatarUrl={initialBot.avatar_url}
        />
      )}
      {tab === 'responder' && (
        <ResponderPanel
          initialResponder={initialResponder}
          initialResponderCalls={initialResponderCalls}
        />
      )}
      {tab === 'receptionist' && (
        <div className="space-y-6">
          <ReceptionistPanel
            initialVoiceReceptionist={initialVoiceReceptionist}
            people={initialPeople}
            onLevelChange={setRxLevel}
          />
          {/* Scheduling is only used at Level 4+ (booking); Call routing only at
              Level 5 (frontline). Hide them otherwise so the page shows only what
              the selected level actually uses. */}
          {rxLevel >= 4 && <SchedulingPanel />}
          {rxLevel >= 5 && <RoutingPanel />}
        </div>
      )}
      {tab === 'knowledge' && <KnowledgePanel initialDocs={initialDocs} />}
    </div>
  )
}

function SubTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2.5 -mb-px text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-brand text-white'
          : 'border-transparent text-gray-500 hover:text-gray-300'
      }`}
    >
      {children}
    </button>
  )
}
