'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useToast, Spinner, EmptyState } from '@/components/ui'

type Item = {
  id: string
  content: string
  done: boolean
  priority: 'none' | 'low' | 'medium' | 'high'
  due_date: string | null
  due_time: string | null
  recurrence: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly'
  board_id: string
  board_name: string
}
type BoardOpt = { id: string; name: string; hidden: boolean }

const PRIORITY_DOT: Record<string, string> = {
  none: 'bg-white/15', low: 'bg-blue-400', medium: 'bg-yellow-400', high: 'bg-red-400',
}
const RECURRENCE_LABEL: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 wks', monthly: 'Monthly',
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function formatTimeOfDay(t: string) {
  const [h, m] = t.split(':')
  const hour = parseInt(h, 10)
  if (Number.isNaN(hour)) return t
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${m ?? '00'} ${ampm}`
}
function dueLabel(due_date: string, due_time: string | null) {
  const d = new Date(due_date + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  let base: string
  if (diff === 0) base = 'Today'
  else if (diff === 1) base = 'Tomorrow'
  else if (diff === -1) base = 'Yesterday'
  else if (diff < 0) base = `${Math.abs(diff)}d ago`
  else if (diff <= 7) base = d.toLocaleDateString('en-US', { weekday: 'short' })
  else base = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return due_time ? `${base}, ${formatTimeOfDay(due_time)}` : base
}

export default function MyTasksView() {
  const toast = useToast()
  const [items, setItems] = useState<Item[]>([])
  const [boards, setBoards] = useState<BoardOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/hub/my-tasks')
      .then(r => r.json())
      .then(d => { setItems(d.items ?? []); setBoards(d.boards ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  async function complete(item: Item) {
    // Optimistically drop it; a recurring task reappears with its next due date on reload.
    setItems(prev => prev.filter(i => i.id !== item.id))
    const res = await fetch(`/api/hub/boards/${item.board_id}/items/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: true }),
    })
    const data = await res.json().catch(() => null)
    if (data?.next_due) toast.success(`Logged · next due ${dueLabel(data.next_due, item.due_time)}`)
    load()
  }

  async function toggleBoard(b: BoardOpt) {
    const hidden = !b.hidden
    setBoards(prev => prev.map(x => x.id === b.id ? { ...x, hidden } : x))
    await fetch('/api/hub/my-tasks/hidden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board_id: b.id, hidden }),
    })
    load()
  }

  const today = todayStr()
  const groups: { key: string; label: string; color: string; rows: Item[] }[] = [
    { key: 'overdue', label: 'Overdue', color: 'text-red-400', rows: items.filter(i => i.due_date && i.due_date < today) },
    { key: 'today', label: 'Today', color: 'text-yellow-400', rows: items.filter(i => i.due_date === today) },
    { key: 'upcoming', label: 'Upcoming', color: 'text-white/60', rows: items.filter(i => i.due_date && i.due_date > today) },
    { key: 'none', label: 'No due date', color: 'text-white/40', rows: items.filter(i => !i.due_date) },
  ]
  const overdueCount = groups[0].rows.length

  return (
    <div className="flex flex-col h-full" onClick={() => setShowSettings(false)}>
      {/* Header */}
      <div className="flex-none px-6 py-4 border-b border-gray-800 flex items-center justify-between max-md:pl-14">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            <h1 className="text-lg font-semibold text-white">My Tasks</h1>
          </div>
          {!loading && (
            <span className="text-xs text-white/40">
              {items.length} open{overdueCount > 0 && <span className="text-red-400"> · {overdueCount} overdue</span>}
            </span>
          )}
        </div>
        {/* Board filter settings */}
        <div className="relative">
          <button
            onClick={e => { e.stopPropagation(); setShowSettings(v => !v) }}
            className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
            title="Choose which boards feed My Tasks"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.879a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Boards
          </button>
          {showSettings && (
            <div className="absolute right-0 top-9 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-2 min-w-[220px] max-h-72 overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="px-3 pb-1.5 text-[11px] text-white/40 font-semibold uppercase tracking-wider">Show tasks from</div>
              {boards.length === 0 && <p className="px-3 py-2 text-xs text-white/40">No boards yet</p>}
              {boards.map(b => (
                <button
                  key={b.id}
                  onClick={() => toggleBoard(b)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left text-gray-200 hover:bg-gray-800 transition-colors"
                >
                  <span className={`w-4 h-4 rounded border flex-none flex items-center justify-center ${!b.hidden ? 'bg-brand border-brand' : 'border-white/30'}`}>
                    {!b.hidden && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  <span className="truncate">{b.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && <div className="py-10 text-center"><Spinner size={6} /></div>}
        {!loading && items.length === 0 && (
          <EmptyState size="lg" title="Nothing assigned to you across your boards." />
        )}

        {!loading && groups.map(group => group.rows.length === 0 ? null : (
          <div key={group.key} className="mb-6">
            <div className={`text-xs font-semibold uppercase tracking-wider mb-2 ${group.color}`}>
              {group.label} <span className="text-white/30">· {group.rows.length}</span>
            </div>
            <div className="space-y-2">
              {group.rows.map(item => (
                <div key={item.id} className="group flex items-start gap-3 p-3 rounded-xl border bg-white/5 border-white/10 hover:border-white/20 transition-colors">
                  <button
                    onClick={() => complete(item)}
                    className="mt-0.5 w-5 h-5 rounded border-2 border-white/30 hover:border-brand flex-none flex items-center justify-center transition-colors"
                    title="Mark complete"
                    aria-label="Mark complete"
                  />
                  <div className="flex-1 min-w-0">
                    <Link href={`/hub/board/${item.board_id}`} className="text-sm text-white leading-snug hover:text-brand transition-colors block">
                      {item.content}
                    </Link>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs">
                      <span className="inline-flex items-center gap-1 text-white/40">
                        <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[item.priority] ?? PRIORITY_DOT.none}`} />
                        {item.board_name}
                      </span>
                      {item.due_date && (
                        <span className={group.key === 'overdue' ? 'text-red-400' : group.key === 'today' ? 'text-yellow-400' : 'text-white/50'}>
                          {dueLabel(item.due_date, item.due_time)}
                        </span>
                      )}
                      {!item.due_date && item.due_time && (
                        <span className="text-white/50">{formatTimeOfDay(item.due_time)}</span>
                      )}
                      {item.recurrence !== 'none' && (
                        <span className="inline-flex items-center gap-1 text-white/40">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          {RECURRENCE_LABEL[item.recurrence]}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
