'use client'

import LeadCard from './LeadCard'
import type { Lead, Stage } from '../TrackerPage'

// The "Needs me" cockpit: a flat, cross-stage list of leads whose drip enrollment
// is paused because they REPLIED — i.e. a real person is waiting on a human (or
// Amber). Newest first. This is the action queue the drip engine feeds.
function recency(l: Lead): number {
  const t = Date.parse(l.stage_changed_at || l.lead_creation_date || '')
  return Number.isNaN(t) ? 0 : t
}

export default function NeedsMeView({
  leads, stages, lightMode, onEdit, onOpenNotes,
}: {
  leads: Lead[]
  stages: Stage[]
  lightMode: boolean
  onEdit: (id: string) => void
  onOpenNotes: (id: string) => void
}) {
  const waiting = leads
    .filter(l => l.drip?.status === 'replied')
    .sort((a, b) => recency(b) - recency(a))

  return (
    <div className="p-4 max-w-4xl mx-auto w-full">
      <div className="mb-4">
        <h2 className={`text-base font-semibold ${lightMode ? 'text-gray-900' : 'text-white'}`}>
          Needs me{waiting.length > 0 ? ` · ${waiting.length}` : ''}
        </h2>
        <p className={`text-sm mt-0.5 ${lightMode ? 'text-gray-500' : 'text-gray-400'}`}>
          Leads who replied to a drip and are waiting on a human. Newest first.
        </p>
      </div>

      {waiting.length === 0 ? (
        <div className={`rounded-xl border border-dashed py-16 text-center text-sm ${lightMode ? 'text-gray-400 border-gray-200' : 'text-gray-600 border-gray-800'}`}>
          You&apos;re all caught up — no leads waiting on a reply. 🎉
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {waiting.map(lead => (
            <LeadCard
              key={lead.id}
              lead={lead}
              stages={stages}
              lightMode={lightMode}
              showStage
              onEdit={onEdit}
              onOpenNotes={onOpenNotes}
            />
          ))}
        </div>
      )}
    </div>
  )
}
