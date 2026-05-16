'use client'

import { useState, useEffect, useRef } from 'react'

type Status = 'available' | 'busy' | 'dnd' | null

const STATUS_OPTIONS: { value: Status; label: string; dot: string; description: string }[] = [
  { value: 'available', label: 'Available', dot: 'bg-green-400', description: 'Ready to chat' },
  { value: 'busy', label: 'Busy', dot: 'bg-yellow-400', description: 'Minimizing interruptions' },
  { value: 'dnd', label: 'Do Not Disturb', dot: 'bg-red-500', description: 'Suppress non-mention notifications' },
  { value: null, label: 'Clear status', dot: 'bg-gray-500', description: '' },
]

export function StatusDot({ status }: { status: string | null | undefined }) {
  if (!status || status === 'available') return <span className="w-2.5 h-2.5 rounded-full bg-green-400 ring-1 ring-[#1A3D5C] flex-none" />
  if (status === 'busy') return <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 ring-1 ring-[#1A3D5C] flex-none" />
  if (status === 'dnd') return <span className="w-2.5 h-2.5 rounded-full bg-red-500 ring-1 ring-[#1A3D5C] flex-none" />
  return <span className="w-2.5 h-2.5 rounded-full bg-gray-500 ring-1 ring-[#1A3D5C] flex-none" />
}

export default function StatusPicker({
  currentStatus,
  displayName,
  userEmail,
}: {
  currentStatus: string | null
  displayName: string
  userEmail: string
}) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status>(currentStatus as Status)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function setMyStatus(newStatus: Status) {
    setSaving(true)
    await fetch('/api/hub/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    setStatus(newStatus)
    setSaving(false)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-white/5 transition-colors text-left"
        title="Set status"
      >
        <div className="relative flex-none">
          <div className="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center text-xs font-bold text-white">
            {displayName.slice(0, 1).toUpperCase()}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5">
            <StatusDot status={status} />
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-white/80 truncate">{displayName}</div>
          <div className="text-xs text-white/40 truncate">{userEmail}</div>
        </div>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-56 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 py-1 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-800">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Set status</p>
          </div>
          {STATUS_OPTIONS.map(opt => {
            const isCurrent = (status ?? null) === opt.value
            return (
              <button
                key={String(opt.value)}
                onClick={() => setMyStatus(opt.value)}
                disabled={saving}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors ${
                  isCurrent ? 'bg-white/10 text-white' : 'text-gray-300 hover:bg-gray-800'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full flex-none ${opt.dot}`} />
                <div>
                  <div className="font-medium">{opt.label}</div>
                  {opt.description && <div className="text-xs text-gray-500">{opt.description}</div>}
                </div>
                {isCurrent && <span className="ml-auto text-[#2E7EB8] text-xs">✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
