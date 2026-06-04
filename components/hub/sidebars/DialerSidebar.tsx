'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
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

type VoicemailRow = {
  id: string
  created_at: string
  from_number: string | null
  recording_duration_sec: number | null
  heard_at: string | null
  heard_by: string | null
  owner_user_id: string | null
  call_id: string | null
  transcript: string | null
  summary: string | null
  contact: { id: string; name: string; phone: string } | { id: string; name: string; phone: string }[] | null
}

type Scope = 'mine' | 'missed' | 'all' | 'voicemail'

function formatPhone(raw: string | null): string {
  if (!raw) return ''
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
  const [vmScope, setVmScope] = useState<'mine' | 'all'>('mine')
  const [calls, setCalls] = useState<CallRow[]>([])
  const [voicemails, setVoicemails] = useState<VoicemailRow[]>([])
  const [unheardCount, setUnheardCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)

  // Effective voicemail scope: non-managers (no canSeeAll) are always on 'mine';
  // managers honor the Mine/All sub-toggle.
  const effectiveVmScope: 'mine' | 'all' = canSeeAll ? vmScope : 'mine'

  const load = useCallback(async () => {
    setLoading(true)
    if (scope === 'voicemail') {
      const res = await fetch(
        `/api/dialer/voicemails?scope=${effectiveVmScope}&limit=100`
      )
      if (res.ok) {
        const data = await res.json()
        setVoicemails(data.voicemails ?? [])
        setUnheardCount(data.unheard_count ?? 0)
      }
    } else {
      const res = await fetch(`/api/dialer/calls?scope=${scope}&limit=100`)
      if (res.ok) {
        const data = await res.json()
        setCalls(data.calls ?? [])
      }
    }
    setLoading(false)
  }, [scope, effectiveVmScope])

  // Always keep unheard count fresh for the tab badge, even when on a different tab.
  // The /voicemails endpoint downgrades unheard → mine_unheard for non-managers,
  // so the badge always shows the count the user can actually see.
  const loadUnheardCount = useCallback(async () => {
    const which = effectiveVmScope === 'all' ? 'unheard' : 'mine_unheard'
    const res = await fetch(`/api/dialer/voicemails?scope=${which}&limit=1`)
    if (res.ok) {
      const data = await res.json()
      setUnheardCount(data.unheard_count ?? 0)
    }
  }, [effectiveVmScope])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadUnheardCount() }, [loadUnheardCount])

  // Light polling — replaces a realtime channel until we wire one in a follow-up
  useEffect(() => {
    const t = setInterval(() => {
      load()
      loadUnheardCount()
    }, 15000)
    return () => clearInterval(t)
  }, [load, loadUnheardCount])

  const tabs: { id: Scope; label: string; show: boolean; badge?: number }[] = [
    { id: 'mine', label: 'Recent', show: true },
    { id: 'missed', label: 'Missed', show: true },
    { id: 'all', label: 'All', show: canSeeAll },
    { id: 'voicemail', label: 'Voicemail', show: true, badge: unheardCount },
  ]

  async function markHeard(id: string, heard: boolean) {
    await fetch(`/api/dialer/voicemails/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ heard }),
    })
    setVoicemails((prev) =>
      prev.map((v) =>
        v.id === id ? { ...v, heard_at: heard ? new Date().toISOString() : null } : v,
      ),
    )
    loadUnheardCount()
  }

  async function deleteVm(id: string) {
    if (!confirm('Delete this voicemail?')) return
    await fetch(`/api/dialer/voicemails/${id}`, { method: 'DELETE' })
    setVoicemails((prev) => prev.filter((v) => v.id !== id))
    if (playingId === id) setPlayingId(null)
    loadUnheardCount()
  }

  function onPlay(id: string) {
    setPlayingId(id)
    // First play auto-marks as heard.
    const vm = voicemails.find((v) => v.id === id)
    if (vm && !vm.heard_at) markHeard(id, true)
  }

  return (
    <aside
      className="h-full w-72 bg-[#0F2E47] text-white flex flex-col flex-none border-r border-white/5 min-h-0"
      aria-label="Dialer sidebar"
    >
      <SidebarHeader title="Dialer" onClose={onClose} onDesktopCollapse={onDesktopCollapse} />

      <div className="px-3 pt-3">
        <Link
          href="/hub/contacts"
          onClick={onClose}
          className="block w-full text-center px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-sm font-medium border border-white/10"
        >
          Contacts
        </Link>
      </div>

      <div className="px-3 pt-2 pb-2">
        <div className="flex gap-1 text-xs">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <button
                key={t.id}
                onClick={() => setScope(t.id)}
                className={`flex-1 px-2 py-1 rounded-md transition relative ${
                  scope === t.id
                    ? 'bg-white/10 text-white'
                    : 'text-white/50 hover:text-white/80'
                }`}
              >
                {t.label}
                {t.badge != null && t.badge > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-[9px] font-semibold text-white">
                    {t.badge > 99 ? '99+' : t.badge}
                  </span>
                )}
              </button>
            ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {scope === 'voicemail' ? (
          <>
            {canSeeAll && (
              <div className="px-3 pt-2 pb-1 flex items-center gap-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => setVmScope('mine')}
                  className={`px-2 py-0.5 rounded ${
                    effectiveVmScope === 'mine'
                      ? 'bg-white/10 text-white'
                      : 'text-white/50 hover:text-white/80'
                  }`}
                >
                  Mine
                </button>
                <button
                  type="button"
                  onClick={() => setVmScope('all')}
                  className={`px-2 py-0.5 rounded ${
                    effectiveVmScope === 'all'
                      ? 'bg-white/10 text-white'
                      : 'text-white/50 hover:text-white/80'
                  }`}
                >
                  All
                </button>
                <span className="ml-auto text-white/30">
                  {effectiveVmScope === 'mine' ? 'General + assigned to you' : 'Everyone'}
                </span>
              </div>
            )}
            <VoicemailList
              voicemails={voicemails}
              loading={loading}
              playingId={playingId}
              onPlay={onPlay}
              onStop={() => setPlayingId(null)}
              onDelete={deleteVm}
              onMarkHeard={markHeard}
              onSelectNumber={onSelectNumber}
            />
          </>
        ) : (
          <CallList
            calls={calls}
            loading={loading}
            scope={scope}
            onSelectNumber={onSelectNumber}
          />
        )}
      </div>

      <div className="px-3 py-2 border-t border-white/5 flex items-center justify-end">
        <span className="text-[10px] text-white/30">Staging</span>
      </div>
    </aside>
  )
}

function CallList({
  calls,
  loading,
  scope,
  onSelectNumber,
}: {
  calls: CallRow[]
  loading: boolean
  scope: Scope
  onSelectNumber?: (phone: string) => void
}) {
  if (loading && calls.length === 0) {
    return <div className="px-4 py-6 text-sm text-white/40">Loading…</div>
  }
  if (!loading && calls.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-white/40">
        {scope === 'missed' ? 'No missed calls.' : 'No calls yet.'}
      </div>
    )
  }
  return (
    <ul>
      {calls.map((c) => {
        const peerNumber = c.direction === 'inbound' ? c.from_number : c.to_number
        const inner = Array.isArray(c.contact) ? c.contact[0] : c.contact
        const displayName = inner?.name ?? null
        const isMissed = ['no-answer', 'busy', 'failed', 'canceled', 'voicemail'].includes(c.status) && c.direction === 'inbound'
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
  )
}

function VoicemailList({
  voicemails,
  loading,
  playingId,
  onPlay,
  onStop,
  onDelete,
  onMarkHeard,
  onSelectNumber,
}: {
  voicemails: VoicemailRow[]
  loading: boolean
  playingId: string | null
  onPlay: (id: string) => void
  onStop: () => void
  onDelete: (id: string) => void
  onMarkHeard: (id: string, heard: boolean) => void
  onSelectNumber?: (phone: string) => void
}) {
  if (loading && voicemails.length === 0) {
    return <div className="px-4 py-6 text-sm text-white/40">Loading…</div>
  }
  if (!loading && voicemails.length === 0) {
    return <div className="px-4 py-6 text-sm text-white/40">No voicemails yet.</div>
  }
  return (
    <ul className="divide-y divide-white/5">
      {voicemails.map((v) => {
        const inner = Array.isArray(v.contact) ? v.contact[0] : v.contact
        const displayName = inner?.name ?? null
        const phone = v.from_number || inner?.phone || ''
        const isPlaying = playingId === v.id
        const unheard = !v.heard_at
        return (
          <li key={v.id} className={`px-3 py-2.5 ${unheard ? 'bg-white/[0.03]' : ''}`}>
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {unheard && (
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400 flex-none" aria-label="unheard" />
                  )}
                  <button
                    type="button"
                    onClick={() => phone && onSelectNumber?.(phone)}
                    className="text-sm font-medium truncate hover:underline text-left flex-1"
                  >
                    {displayName || formatPhone(phone) || 'Unknown'}
                  </button>
                  <span className="text-[10px] text-white/40 flex-none">
                    {formatRelative(v.created_at)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-[11px] text-white/40 truncate">
                    {displayName ? formatPhone(phone) : null}
                  </span>
                  {v.recording_duration_sec ? (
                    <span className="text-[10px] text-white/40 flex-none">
                      {formatDuration(v.recording_duration_sec)}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {/* AI transcript summary — shows once transcription is done */}
            {(v.summary || v.transcript) && !isPlaying && (
              <p className="mt-1 text-[11px] text-white/40 leading-snug line-clamp-2">
                {v.summary || v.transcript!.slice(0, 120)}
              </p>
            )}

            {isPlaying ? (
              <div className="mt-2">
                <VoicemailPlayer voicemailId={v.id} onEnded={onStop} />
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onPlay(v.id)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-sky-700/30 hover:bg-sky-700/50 text-sky-100"
                  aria-label="Play voicemail"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Play
                </button>
                <button
                  type="button"
                  onClick={() => onMarkHeard(v.id, !v.heard_at)}
                  className="px-2 py-1 rounded text-xs text-white/60 hover:bg-white/5 hover:text-white"
                >
                  {v.heard_at ? 'Mark unheard' : 'Mark heard'}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(v.id)}
                  className="ml-auto px-2 py-1 rounded text-xs text-red-300/70 hover:bg-red-900/30 hover:text-red-300"
                  aria-label="Delete voicemail"
                >
                  Delete
                </button>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function VoicemailPlayer({ voicemailId, onEnded }: { voicemailId: string; onEnded: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    audioRef.current?.play().catch(() => { /* autoplay blocked — user must press play */ })
  }, [])

  return (
    <audio
      ref={audioRef}
      src={`/api/dialer/voicemails/${voicemailId}/audio`}
      controls
      onEnded={onEnded}
      className="w-full h-8"
    />
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
