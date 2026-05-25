'use client'

import { useEffect, useState, useCallback } from 'react'
import { SidebarHeader } from './SidebarShell'

type CallRow = {
  id: string
  direction: 'inbound' | 'outbound'
  from_number: string
  to_number: string
  status: string
  duration_seconds: number
  created_at: string
  answered_at: string | null
  ended_at: string | null
  recording_url: string | null
  handled_by: string | null
  initiated_by: string | null
  contact: { id: string; name: string; phone: string } | { id: string; name: string; phone: string }[] | null
  conversation_id: string | null
}

type Scope = 'mine' | 'missed' | 'all'

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return raw
}

function formatRelative(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (d.toDateString() === now.toDateString()) return 'today'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDuration(seconds: number): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function DialerSidebar({
  onClose,
  onDesktopCollapse,
  canSeeAll,
  onSelectNumber,
}: {
  onClose?: () => void
  onDesktopCollapse?: () => void
  canSeeAll: boolean
  onSelectNumber?: (phone: string) => void
}) {
  const [scope, setScope] = useState<Scope>('mine')
  const [calls, setCalls] = useState<CallRow[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/dialer/calls?scope=${scope}&limit=100`)
    if (res.ok) {
      const data = await res.json()
      setCalls(data.calls ?? [])
    }
    setLoading(false)
  }, [scope])

  useEffect(() => { load() }, [load])

  // Light polling — replaces a realtime channel until we wire one in a follow-up
  useEffect(() => {
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [load])

  const tabs: { id: Scope; label: string; show: boolean }[] = [
    { id: 'mine', label: 'Recent', show: true },
    { id: 'missed', label: 'Missed', show: true },
    { id: 'all', label: 'All', show: canSeeAll },
  ]

  return (
    <aside
      className="h-full w-72 bg-[#0F2E47] text-white flex flex-col flex-none border-r border-white/5 min-h-0"
      aria-label="Dialer sidebar"
    >
      <SidebarHeader title="Dialer" onClose={onClose} onDesktopCollapse={onDesktopCollapse} />

      <div className="px-3 pt-3 pb-2">
        <div className="flex gap-1 text-xs">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <button
                key={t.id}
                onClick={() => setScope(t.id)}
                className={`flex-1 px-2 py-1 rounded-md transition ${
                  scope === t.id
                    ? 'bg-white/10 text-white'
                    : 'text-white/50 hover:text-white/80'
                }`}
              >
                {t.label}
              </button>
            ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && calls.length === 0 && (
          <div className="px-4 py-6 text-sm text-white/40">Loading…</div>
        )}
        {!loading && calls.length === 0 && (
          <div className="px-4 py-6 text-sm text-white/40">
            {scope === 'missed' ? 'No missed calls.' : 'No calls yet.'}
          </div>
        )}
        <ul>
          {calls.map((c) => {
            const peerNumber = c.direction === 'inbound' ? c.from_number : c.to_number
            const inner = Array.isArray(c.contact) ? c.contact[0] : c.contact
            const displayName = inner?.name ?? null
            const isMissed = ['no-answer', 'busy', 'failed', 'canceled'].includes(c.status) && c.direction === 'inbound'
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelectNumber?.(peerNumber)}
                  className="w-full text-left px-4 py-2 border-l-2 border-transparent hover:bg-white/5"
                  title={`${c.status} · ${c.direction}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-medium text-sm truncate ${isMissed ? 'text-red-300' : ''}`}>
                      {displayName || formatPhone(peerNumber) || 'Unknown'}
                    </span>
                    <span className="text-[10px] text-white/40 flex-none">
                      {formatRelative(c.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-[11px] text-white/40 truncate flex items-center gap-1">
                      <DirectionIcon direction={c.direction} missed={isMissed} />
                      {displayName ? formatPhone(peerNumber) : c.status}
                    </span>
                    {c.duration_seconds > 0 && (
                      <span className="text-[10px] text-white/40 flex-none">
                        {formatDuration(c.duration_seconds)}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="px-3 py-2 border-t border-white/5 flex items-center justify-between">
        <span className="text-[11px] text-white/50">Voicemail coming soon</span>
        <span className="text-[10px] text-white/30">Staging</span>
      </div>
    </aside>
  )
}

function DirectionIcon({ direction, missed }: { direction: 'inbound' | 'outbound'; missed: boolean }) {
  const color = missed ? 'text-red-400' : direction === 'inbound' ? 'text-emerald-400' : 'text-sky-400'
  // Inbound = arrow pointing down-left (into phone). Outbound = up-right.
  const d = direction === 'inbound' ? 'M19 12H5m0 0l4 4m-4-4l4-4' : 'M5 12h14m0 0l-4-4m4 4l-4 4'
  return (
    <svg className={`w-3 h-3 ${color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}
