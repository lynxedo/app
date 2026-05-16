'use client'

import { useState, useEffect } from 'react'

type Level = 'all' | 'mentions' | 'muted'

const LEVEL_OPTIONS: { value: Level; label: string; description: string }[] = [
  { value: 'all', label: 'All messages', description: 'Every message triggers a push notification' },
  { value: 'mentions', label: 'Mentions only', description: 'Only when someone @mentions you' },
  { value: 'muted', label: 'Nothing', description: 'No push notifications at all' },
]

export default function NotifPrefsModal({ onClose }: { onClose: () => void }) {
  const [level, setLevel] = useState<Level>('all')
  const [dndEnabled, setDndEnabled] = useState(false)
  const [dndStart, setDndStart] = useState('22:00')
  const [dndEnd, setDndEnd] = useState('07:00')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/hub/notification-prefs')
      .then(r => r.json())
      .then(d => {
        const global = (d.prefs ?? []).find((p: { room_id: string | null }) => p.room_id === null)
        if (global) {
          setLevel(global.level ?? 'all')
          setDndEnabled(global.dnd_enabled ?? false)
          if (global.dnd_start) setDndStart(global.dnd_start)
          if (global.dnd_end) setDndEnd(global.dnd_end)
        }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  async function save() {
    setSaving(true)
    await fetch('/api/hub/notification-prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: null,
        level,
        dnd_enabled: dndEnabled,
        dnd_start: dndEnabled ? dndStart : null,
        dnd_end: dndEnabled ? dndEnd : null,
      }),
    })
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="font-semibold text-white">Notification Preferences</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">✕</button>
        </div>

        {!loaded ? (
          <div className="px-5 py-10 flex justify-center">
            <div className="w-5 h-5 border-2 border-[#2E7EB8] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="px-5 py-4 space-y-5">
            {/* Global level */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Notify me about</p>
              <div className="space-y-1">
                {LEVEL_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setLevel(opt.value)}
                    className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-sm text-left transition-colors ${
                      level === opt.value ? 'bg-[#2E7EB8]/20 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`}
                  >
                    <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-none transition-colors ${
                      level === opt.value ? 'border-[#2E7EB8]' : 'border-gray-600'
                    }`}>
                      {level === opt.value && <div className="w-2 h-2 rounded-full bg-[#2E7EB8]" />}
                    </div>
                    <div>
                      <div className="font-medium">{opt.label}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{opt.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* DND schedule */}
            <div className="border-t border-gray-800 pt-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-white">Do Not Disturb schedule</p>
                  <p className="text-xs text-gray-500 mt-0.5">Silence all pushes during these hours</p>
                </div>
                <button
                  onClick={() => setDndEnabled(d => !d)}
                  className={`relative flex-none w-10 h-6 rounded-full transition-colors ${dndEnabled ? 'bg-[#2E7EB8]' : 'bg-gray-700'}`}
                >
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${dndEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
              </div>
              {dndEnabled && (
                <div className="flex items-center gap-3 mt-3">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 mb-1 block">From</label>
                    <input
                      type="time"
                      value={dndStart}
                      onChange={e => setDndStart(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white outline-none focus:border-[#2E7EB8] transition-colors"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 mb-1 block">To</label>
                    <input
                      type="time"
                      value={dndEnd}
                      onChange={e => setDndEnd(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white outline-none focus:border-[#2E7EB8] transition-colors"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="px-5 py-4 border-t border-gray-800 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!loaded || saving}
            className="flex-1 py-2 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
