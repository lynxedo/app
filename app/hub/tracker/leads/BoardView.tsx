'use client'

import { useEffect, useState, type DragEvent } from 'react'
import LeadCard from './LeadCard'
import type { Stage, StageGroup } from '../TrackerPage'

// Kanban cockpit: each pipeline stage is a column of draggable LeadCards, colored
// by drip state. Drag a card to another column → optimistic stage move via the
// existing PATCH (TrackerPage.onMoveStage). Terminal stages (system_role won/lost)
// are tucked behind a "show closed" toggle so the 300+ won leads don't bury the
// live pipeline. Desktop-first — the Table view is the mobile fallback.
const SHOW_CLOSED_KEY = 'tracker-board-show-closed'

function isClosed(g: { system_role?: string | null }): boolean {
  return g.system_role === 'won' || g.system_role === 'lost'
}

export default function BoardView({
  groups, stages, lightMode, onMoveStage, onEdit, onOpenNotes,
}: {
  groups: StageGroup[]
  stages: Stage[]
  lightMode: boolean
  onMoveStage: (id: string, stageKey: string) => void
  onEdit: (id: string) => void
  onOpenNotes: (id: string) => void
}) {
  const [showClosed, setShowClosed] = useState(false)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

  useEffect(() => {
    if (localStorage.getItem(SHOW_CLOSED_KEY) === '1') setShowClosed(true)
  }, [])

  function toggleClosed() {
    setShowClosed(v => { const next = !v; localStorage.setItem(SHOW_CLOSED_KEY, next ? '1' : '0'); return next })
  }

  const closedCount = groups.filter(isClosed).length
  const visibleGroups = groups.filter(g => showClosed || !isClosed(g))

  function onColumnDrop(e: DragEvent<HTMLDivElement>, stageKey: string) {
    e.preventDefault()
    setDragOverKey(null)
    const id = e.dataTransfer.getData('text/x-tracker-lead')
    if (id) onMoveStage(id, stageKey)
  }

  const colBg = lightMode ? 'bg-gray-50 border-gray-200' : 'bg-gray-900/40 border-gray-800'
  const emptyCls = lightMode ? 'text-gray-400 border-gray-200' : 'text-gray-600 border-gray-800'

  return (
    <div className="p-3">
      {closedCount > 0 && (
        <div className="flex items-center justify-end pb-2">
          <button
            onClick={toggleClosed}
            className="text-xs font-medium px-3 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 transition-colors"
          >
            {showClosed ? 'Hide closed' : `Show closed (${closedCount})`}
          </button>
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-3">
        {visibleGroups.map(group => {
          const isOver = dragOverKey === group.key
          return (
            <div
              key={group.key}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverKey !== group.key) setDragOverKey(group.key) }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverKey(k => k === group.key ? null : k) }}
              onDrop={e => onColumnDrop(e, group.key)}
              className={`w-80 shrink-0 flex flex-col rounded-xl border transition-colors ${colBg} ${isOver ? 'ring-2 ring-indigo-400' : ''}`}
            >
              {/* Column header tinted with the stage color */}
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-t-xl border-b border-white/5"
                style={{ backgroundColor: group.color + (lightMode ? '26' : '22') }}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                <span className={`text-sm font-semibold truncate ${lightMode ? 'text-gray-800' : 'text-white'}`}>{group.label}</span>
                <span className={`ml-auto text-xs font-medium px-1.5 py-0.5 rounded-full ${lightMode ? 'bg-white/70 text-gray-600' : 'bg-black/30 text-gray-300'}`}>
                  {group.leads.length}
                </span>
              </div>

              {/* Scrollable stack of cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[calc(100vh_-_240px)] min-h-24">
                {group.leads.map(lead => (
                  <div
                    key={lead.id}
                    draggable
                    onDragStart={e => { e.dataTransfer.setData('text/x-tracker-lead', lead.id); e.dataTransfer.effectAllowed = 'move' }}
                    className="cursor-grab active:cursor-grabbing"
                  >
                    <LeadCard lead={lead} stages={stages} lightMode={lightMode} onEdit={onEdit} onOpenNotes={onOpenNotes} />
                  </div>
                ))}
                {group.leads.length === 0 && (
                  <div className={`text-xs italic text-center py-8 border border-dashed rounded-lg ${emptyCls}`}>
                    Drop a lead here
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
