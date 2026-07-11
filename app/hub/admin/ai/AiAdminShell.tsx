'use client'

import { useState } from 'react'
import GuardianPanel from './GuardianPanel'
import ResponderPanel from './ResponderPanel'
import ReceptionistPanel from './ReceptionistPanel'
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
  greeting: string
  instructions: string
  voice_id: string
  greeting_default: string
  instructions_default: string
  voice_id_default: string
}

type SubTab = 'guardian' | 'responder' | 'receptionist' | 'knowledge'

export default function AiAdminShell({
  isSuperAdmin,
  initialSettings,
  initialPeople,
  initialRooms,
  initialDocs,
  initialResponder,
  initialResponderCalls,
  initialVoiceReceptionist,
}: {
  isSuperAdmin: boolean
  initialSettings: Settings
  initialPeople: Person[]
  initialRooms: Room[]
  initialDocs: Doc[]
  initialResponder: Omit<ResponderSettings, 'id' | 'company_id'> | null
  initialResponderCalls: ResponderCall[]
  initialVoiceReceptionist: VoiceReceptionistInitial
}) {
  const [tab, setTab] = useState<SubTab>('guardian')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">AI</h1>
        <p className="text-sm text-white/60 mt-1">
          Guardian, the auto-text responder, the AI voice receptionist, and the shared knowledge base.
        </p>
      </header>

      <div className="flex gap-1 border-b border-gray-800 flex-wrap">
        <SubTabButton active={tab === 'guardian'} onClick={() => setTab('guardian')}>
          Guardian
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
        />
      )}
      {tab === 'responder' && (
        <ResponderPanel
          initialResponder={initialResponder}
          initialResponderCalls={initialResponderCalls}
        />
      )}
      {tab === 'receptionist' && (
        <ReceptionistPanel initialVoiceReceptionist={initialVoiceReceptionist} />
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
