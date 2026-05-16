'use client'

import { useState, useEffect, useRef } from 'react'

type Level = 'all' | 'mentions' | 'muted'

const LEVELS: { value: Level; label: string }[] = [
  { value: 'all', label: 'All messages' },
  { value: 'mentions', label: 'Mentions only' },
  { value: 'muted', label: 'Muted' },
]

export default function RoomNotifBell({ roomId }: { roomId: string }) {
  const [level, setLevel] = useState<Level>('all')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/hub/notification-prefs')
      .then(r => r.json())
      .then(d => {
        const pref = (d.prefs ?? []).find((p: { room_id: string | null }) => p.room_id === roomId)
        if (pref) setLevel(pref.level)
      })
      .catch(() => {})
  }, [roomId])

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function select(newLevel: Level) {
    setSaving(true)
    await fetch('/api/hub/notification-prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: roomId, level: newLevel }),
    })
    setLevel(newLevel)
    setSaving(false)
    setOpen(false)
  }

  const isMuted = level === 'muted'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={saving}
        title={isMuted ? 'Notifications muted' : 'Notification settings'}
        className={`p-1.5 rounded-lg transition-colors ${
          isMuted ? 'text-gray-600 hover:text-gray-400' : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        {isMuted ? (
          <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.143 17.082a24.248 24.248 0 003.844.148m-3.844-.148a23.856 23.856 0 01-5.455-1.31 8.964 8.964 0 002.555-6.912V11a6 6 0 013.279-5.378m7.664 5.378c0 4.036 1.2 7.073 2.554 8.77a8.967 8.967 0 01-2.554.77M17.143 3.5A6.003 6.003 0 0012 3m0 0a6.003 6.003 0 00-5.143 0.5M12 3v.01M3 3l18 18" />
          </svg>
        ) : (
          <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 py-1 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-800">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Notifications</p>
          </div>
          {LEVELS.map(opt => (
            <button
              key={opt.value}
              onClick={() => select(opt.value)}
              disabled={saving}
              className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors ${
                level === opt.value ? 'bg-white/10 text-white' : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              <span>{opt.label}</span>
              {level === opt.value && <span className="ml-auto text-[#2E7EB8] text-xs">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
