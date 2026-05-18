'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

type HubUser = { id: string; display_name: string; avatar_url?: string | null }

type BoardItem = {
  id: string
  content: string
  done: boolean
  done_at: string | null
  priority: 'none' | 'low' | 'medium' | 'high'
  due_date: string | null
  assignee_id: string | null
  created_by: string
  created_at: string
  assignee?: HubUser | null
  creator?: HubUser | null
}

type Board = {
  id: string
  name: string
  is_private: boolean
  is_personal: boolean
  created_by: string
}

const PRIORITY_CONFIG = {
  none:   { label: 'None',   dot: 'bg-white/20',   text: 'text-white/30' },
  low:    { label: 'Low',    dot: 'bg-blue-400',    text: 'text-blue-400' },
  medium: { label: 'Medium', dot: 'bg-yellow-400',  text: 'text-yellow-400' },
  high:   { label: 'High',   dot: 'bg-red-400',     text: 'text-red-400' },
}

function priorityDot(priority: string) {
  const cfg = PRIORITY_CONFIG[priority as keyof typeof PRIORITY_CONFIG] ?? PRIORITY_CONFIG.none
  return <span className={`inline-block w-2.5 h-2.5 rounded-full flex-none ${cfg.dot}`} title={cfg.label} />
}

function formatDue(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return { label: 'Today', color: 'text-yellow-400' }
  if (diff === 1) return { label: 'Tomorrow', color: 'text-blue-400' }
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, color: 'text-red-400' }
  if (diff <= 7) return { label: d.toLocaleDateString('en-US', { weekday: 'short' }), color: 'text-white/60' }
  return { label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), color: 'text-white/60' }
}

export default function BoardView({
  board,
  hubUsers,
  currentUserId,
}: {
  board: Board
  hubUsers: HubUser[]
  currentUserId: string
}) {
  const [items, setItems] = useState<BoardItem[]>([])
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [loading, setLoading] = useState(true)
  const [composing, setComposing] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [showDatePicker, setShowDatePicker] = useState<string | null>(null)
  const [showAssignPicker, setShowAssignPicker] = useState<string | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  const loadItems = useCallback(() => {
    setLoading(true)
    fetch(`/api/hub/boards/${board.id}/items?filter=${filter}`)
      .then(r => r.json())
      .then(d => { setItems(d.items ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [board.id, filter])

  useEffect(() => { loadItems() }, [loadItems])

  async function addItem() {
    if (!composing.trim() || submitting) return
    setSubmitting(true)
    const res = await fetch(`/api/hub/boards/${board.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: composing.trim() }),
    })
    const item = await res.json()
    setSubmitting(false)
    setComposing('')
    if (res.ok) {
      if (filter === 'open') setItems(prev => [...prev, item])
    }
  }

  async function toggleDone(item: BoardItem) {
    const optimistic = { ...item, done: !item.done, done_at: !item.done ? new Date().toISOString() : null }
    setItems(prev => prev.map(i => i.id === item.id ? optimistic : i))
    await fetch(`/api/hub/boards/${board.id}/items/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: !item.done }),
    })
    // Reload so done items disappear from open filter
    loadItems()
  }

  async function setPriority(item: BoardItem, priority: string) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, priority: priority as BoardItem['priority'] } : i))
    setOpenMenuId(null)
    await fetch(`/api/hub/boards/${board.id}/items/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority }),
    })
  }

  async function setDueDate(item: BoardItem, due_date: string | null) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, due_date } : i))
    setShowDatePicker(null)
    await fetch(`/api/hub/boards/${board.id}/items/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date }),
    })
  }

  async function setAssignee(item: BoardItem, assignee_id: string | null) {
    const assignee = hubUsers.find(u => u.id === assignee_id) ?? null
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, assignee_id, assignee } : i))
    setShowAssignPicker(null)
    await fetch(`/api/hub/boards/${board.id}/items/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee_id }),
    })
  }

  async function deleteItem(id: string) {
    setItems(prev => prev.filter(i => i.id !== id))
    setOpenMenuId(null)
    await fetch(`/api/hub/boards/${board.id}/items/${id}`, { method: 'DELETE' })
  }

  return (
    <div className="flex flex-col h-full" onClick={() => { setOpenMenuId(null); setShowDatePicker(null); setShowAssignPicker(null) }}>
      {/* Header */}
      <div className="flex-none px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-[#2E7EB8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <h1 className="text-lg font-semibold text-white">{board.name}</h1>
          </div>
          {board.is_private && (
            <span className="text-xs text-white/40 bg-white/10 px-2 py-0.5 rounded-full">Private</span>
          )}
          {board.is_personal && (
            <span className="text-xs text-white/40 bg-white/10 px-2 py-0.5 rounded-full">Personal</span>
          )}
        </div>
        {/* Filter toggle */}
        <div className="flex bg-white/10 rounded-lg p-0.5 gap-0.5">
          {(['open', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={e => { e.stopPropagation(); setFilter(f) }}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filter === f ? 'bg-[#2E7EB8] text-white' : 'text-white/50 hover:text-white'}`}
            >
              {f === 'open' ? 'Open' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {loading && (
          <p className="text-sm text-white/40 text-center py-8">Loading…</p>
        )}
        {!loading && items.length === 0 && (
          <div className="text-center py-16">
            <p className="text-white/30 text-sm">
              {filter === 'open' ? 'No open tasks. Add one below.' : 'No tasks yet.'}
            </p>
          </div>
        )}
        {items.map(item => (
          <div
            key={item.id}
            className={`group flex items-start gap-3 p-3 rounded-xl border transition-colors ${
              item.done
                ? 'bg-white/[0.02] border-white/5'
                : 'bg-white/5 border-white/10 hover:border-white/20'
            }`}
            onClick={e => e.stopPropagation()}
          >
            {/* Checkbox */}
            <button
              onClick={() => toggleDone(item)}
              className={`mt-0.5 w-5 h-5 rounded border-2 flex-none flex items-center justify-center transition-colors ${
                item.done
                  ? 'bg-[#2E7EB8] border-[#2E7EB8]'
                  : 'border-white/30 hover:border-[#2E7EB8]'
              }`}
            >
              {item.done && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className={`text-sm leading-snug ${item.done ? 'line-through text-white/30' : 'text-white'}`}>
                {item.content}
              </p>

              {/* Meta row */}
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {/* Priority */}
                <div className="relative">
                  <button
                    onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === `p-${item.id}` ? null : `p-${item.id}`) }}
                    className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
                  >
                    {priorityDot(item.priority)}
                    <span className={PRIORITY_CONFIG[item.priority as keyof typeof PRIORITY_CONFIG]?.text ?? 'text-white/30'}>
                      {item.priority === 'none' ? 'Priority' : PRIORITY_CONFIG[item.priority as keyof typeof PRIORITY_CONFIG]?.label}
                    </span>
                  </button>
                  {openMenuId === `p-${item.id}` && (
                    <div className="absolute left-0 top-6 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1 min-w-[120px]" onClick={e => e.stopPropagation()}>
                      {(['none', 'low', 'medium', 'high'] as const).map(p => (
                        <button
                          key={p}
                          onClick={() => setPriority(item, p)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800"
                        >
                          <span className={`w-2 h-2 rounded-full ${PRIORITY_CONFIG[p].dot}`} />
                          {PRIORITY_CONFIG[p].label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Due date */}
                <div className="relative">
                  <button
                    onClick={e => { e.stopPropagation(); setShowDatePicker(showDatePicker === item.id ? null : item.id) }}
                    className="flex items-center gap-1 text-xs hover:text-white/70 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {item.due_date ? (
                      <span className={formatDue(item.due_date).color}>{formatDue(item.due_date).label}</span>
                    ) : (
                      <span className="text-white/30">Due date</span>
                    )}
                  </button>
                  {showDatePicker === item.id && (
                    <div className="absolute left-0 top-6 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-3" onClick={e => e.stopPropagation()}>
                      <input
                        type="date"
                        defaultValue={item.due_date ?? ''}
                        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-[#2E7EB8]"
                        onChange={e => setDueDate(item, e.target.value || null)}
                      />
                      {item.due_date && (
                        <button onClick={() => setDueDate(item, null)} className="block mt-2 text-xs text-white/40 hover:text-white/70 w-full text-left">
                          Clear
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Assignee */}
                <div className="relative">
                  <button
                    onClick={e => { e.stopPropagation(); setShowAssignPicker(showAssignPicker === item.id ? null : item.id) }}
                    className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors"
                  >
                    {item.assignee ? (
                      <>
                        <div className="w-4 h-4 rounded-full bg-[#2E7EB8] flex items-center justify-center text-[9px] font-bold text-white flex-none">
                          {item.assignee.display_name.slice(0, 1).toUpperCase()}
                        </div>
                        <span className="text-white/60">{item.assignee.display_name.split(' ')[0]}</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <span>Assign</span>
                      </>
                    )}
                  </button>
                  {showAssignPicker === item.id && (
                    <div className="absolute left-0 top-6 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1 min-w-[160px] max-h-48 overflow-y-auto" onClick={e => e.stopPropagation()}>
                      {item.assignee && (
                        <button onClick={() => setAssignee(item, null)} className="w-full px-3 py-2 text-xs text-white/50 hover:bg-gray-800 text-left">
                          Unassign
                        </button>
                      )}
                      {hubUsers.filter(u => !u.id.includes('bot')).map(u => (
                        <button
                          key={u.id}
                          onClick={() => setAssignee(item, u.id)}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-gray-800 ${item.assignee_id === u.id ? 'text-white' : 'text-gray-300'}`}
                        >
                          <div className="w-5 h-5 rounded-full bg-gray-600 flex items-center justify-center text-[10px] font-bold text-white flex-none">
                            {u.display_name.slice(0, 1).toUpperCase()}
                          </div>
                          {u.display_name.split(' ')[0]}
                          {item.assignee_id === u.id && <span className="ml-auto text-[#2E7EB8]">✓</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Delete (hover) */}
            <button
              onClick={e => { e.stopPropagation(); deleteItem(item.id) }}
              className="flex-none opacity-0 group-hover:opacity-100 transition-opacity text-white/20 hover:text-red-400 p-1 rounded"
              title="Delete task"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="flex-none border-t border-gray-800 px-6 py-4">
        <div className="flex items-start gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus-within:border-[#2E7EB8] transition-colors">
          <svg className="w-4 h-4 text-white/30 mt-0.5 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <textarea
            ref={composerRef}
            value={composing}
            onChange={e => setComposing(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                addItem()
              }
            }}
            placeholder="Add a task… (Enter to save)"
            rows={1}
            className="flex-1 bg-transparent text-sm text-white placeholder-white/30 outline-none resize-none"
            style={{ minHeight: '1.25rem' }}
          />
          {composing.trim() && (
            <button
              onClick={addItem}
              disabled={submitting}
              className="flex-none bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-white text-xs font-medium px-3 py-1 rounded-lg transition-colors"
            >
              Add
            </button>
          )}
        </div>
        <p className="text-xs text-white/20 mt-1.5 pl-1">Press Enter to add · Shift+Enter for new line</p>
      </div>
    </div>
  )
}
