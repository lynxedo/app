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
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/hub/notification-prefs')
      .then(r => r.json())
      .then(d => {
        const global = (d.prefs ?? []).find((p: { room_id: string | null }) => p.room_id === null)
        if (global) {
          setLevel(global.level ?? 'all')
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
      body: JSON.stringify({ room_id: null, level }),
    })
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="font-semibold text-white">Notification Preferences</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors" aria-label="Close">✕</button>
        </div>

        {!loaded ? (
          <div className="px-5 py-10 flex justify-center">
            <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
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
                      level === opt.value ? 'bg-brand/20 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`}
                  >
                    <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-none transition-colors ${
                      level === opt.value ? 'border-brand' : 'border-gray-600'
                    }`}>
                      {level === opt.value && <div className="w-2 h-2 rounded-full bg-brand" />}
                    </div>
                    <div>
                      <div className="font-medium">{opt.label}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{opt.description}</div>
                    </div>
                  </button>
                ))}
              </div>
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
            className="flex-1 py-2 rounded-xl bg-brand hover:bg-brand-hover disabled:opacity-40 text-sm text-white font-medium transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
