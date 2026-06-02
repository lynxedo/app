'use client'

import { useState } from 'react'
import TxtAdminPanel from './TxtAdminPanel'
import TxtNumbersPanel, { type TxtNumber } from './TxtNumbersPanel'
import OnMyWayPanel from './OnMyWayPanel'

type Template = {
  id: string
  scope: 'org' | 'personal'
  title: string
  body: string
  sort_order: number
  owner_user_id: string | null
  updated_at: string
}

type SubTab = 'templates' | 'numbers' | 'onmyway'

export default function TxtAdminShell({
  initialTemplates,
  initialNumbers,
  initialOnMyWayTemplate,
}: {
  initialTemplates: Template[]
  initialNumbers: TxtNumber[]
  initialOnMyWayTemplate: string | null
}) {
  const [tab, setTab] = useState<SubTab>('templates')

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-gray-800">
        <SubTabButton active={tab === 'templates'} onClick={() => setTab('templates')}>
          Templates
        </SubTabButton>
        <SubTabButton active={tab === 'numbers'} onClick={() => setTab('numbers')}>
          Numbers
        </SubTabButton>
        <SubTabButton active={tab === 'onmyway'} onClick={() => setTab('onmyway')}>
          On My Way
        </SubTabButton>
      </div>

      {tab === 'templates' && <TxtAdminPanel initialTemplates={initialTemplates} />}
      {tab === 'numbers' && <TxtNumbersPanel initialNumbers={initialNumbers} />}
      {tab === 'onmyway' && <OnMyWayPanel initialTemplate={initialOnMyWayTemplate} />}
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
      className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-emerald-500 text-white'
          : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600'
      }`}
    >
      {children}
    </button>
  )
}
