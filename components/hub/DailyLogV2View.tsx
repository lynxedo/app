'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import RoutePreviewMap, { type RoutePreviewPin } from '@/components/RoutePreviewMap'

type HubUser = { id: string; display_name: string; avatar_url?: string | null }

type LineItem = {
  name: string
  qty: number
  unitPrice: number
  totalPrice: number
}

type WeatherSnapshot = {
  observed_at: string | null
  station_id: string | null
  station_name: string | null
  temperature_f: number | null
  temperature_c: number | null
  conditions: string | null
  wind_mph: number | null
  wind_direction: number | null
  humidity_pct: number | null
  source?: 'nws'
}

type Stop = {
  id: string
  ord: number
  jobber_visit_id: string | null
  client_name: string
  client_phone: string | null
  address: string
  lat: number | null
  lng: number | null
  job_title: string | null
  line_items: LineItem[]
  instructions: string | null
  scheduled_start_at: string | null
  scheduled_end_at: string | null
  duration_minutes: number | null
  status: 'pending' | 'in_progress' | 'complete' | 'skipped'
  arrived_at: string | null
  completed_at: string | null
  notes: string | null
  on_my_way_sent_at: string | null
  on_my_way_eta_minutes: number | null
  weather: WeatherSnapshot | null
  pesticide_record_id: string | null
  // Transient client-side: set when a Complete/Reopen call returns a warning
  // (e.g. Jobber push failed). Not stored on server. Cleared on next action.
  _jobber_warning?: string | null
  // Transient: error from On-My-Way send
  _omw_error?: string | null
}

type Entry = {
  id: string
  log_date: string
  office_notes: string | null
  route_sheet_url: string | null
  route_sheet_name: string | null
  completed_at: string | null
  closed_at: string | null
  tech: HubUser | null
  stops: Stop[]
  secondary_techs: HubUser[]
}

type ApiResponse = {
  entries: Entry[]
  depot: { lat: number; lng: number } | null
}

function todayStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function offsetDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatDateHeading(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function pinLabel(ord: number): string {
  return ord <= 9 ? String(ord) : String.fromCharCode(97 + (ord - 10))
}

function UserAvatar({ user, size = 8 }: { user: HubUser | null; size?: number }) {
  if (!user) return null
  const initials = user.display_name.split(/\s+/).map(n => n[0]).join('').slice(0, 2).toUpperCase()
  const px = size * 4
  return (
    <div
      style={{ width: px, height: px }}
      className="rounded-full bg-[#2E7EB8] flex items-center justify-center text-white font-semibold text-xs flex-none"
    >
      {initials}
    </div>
  )
}

export default function DailyLogV2View({
  currentUserId,
  isAdmin,
}: {
  currentUserId: string
  isAdmin: boolean
}) {
  const [date, setDate] = useState<string>(todayStr())
  const [filter, setFilter] = useState<'all' | 'mine'>('all')
  const [entries, setEntries] = useState<Entry[]>([])
  const [depot, setDepot] = useState<{ lat: number; lng: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [expandedStopId, setExpandedStopId] = useState<string | null>(null)
  const [pendingActionStopId, setPendingActionStopId] = useState<string | null>(null)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // Local patch helper — surgical edits to entries[] without refetching.
  const patchStop = useCallback((stopId: string, fields: Partial<Stop>) => {
    setEntries(prev =>
      prev.map(e => ({
        ...e,
        stops: e.stops.map(s => s.id === stopId ? { ...s, ...fields } : s),
      })),
    )
  }, [])

  const handleToggleExpand = useCallback((stopId: string) => {
    setExpandedStopId(curr => curr === stopId ? null : stopId)
  }, [])

  const handleComplete = useCallback(async (stopId: string, undo: boolean) => {
    setPendingActionStopId(stopId)
    try {
      const res = await fetch(`/api/hub/daily-log/stops/${stopId}/complete`, {
        method: undo ? 'DELETE' : 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || `Failed (${res.status})`)
      }
      // POST returns weather + pesticide_record_id alongside the standard
      // stop fields; DELETE doesn't include them (those are completion-time
      // artifacts). Use `in` to detect rather than reading undefined values.
      const patch: Partial<Stop> = {
        status: data.stop?.status,
        arrived_at: data.stop?.arrived_at ?? null,
        completed_at: data.stop?.completed_at ?? null,
        _jobber_warning: data.jobber_warning ?? null,
      }
      if (data.stop && 'weather' in data.stop) patch.weather = data.stop.weather ?? null
      if (data.stop && 'pesticide_record_id' in data.stop) patch.pesticide_record_id = data.stop.pesticide_record_id ?? null
      patchStop(stopId, patch)
    } catch (e) {
      patchStop(stopId, {
        _jobber_warning: e instanceof Error ? e.message : 'Action failed',
      })
    } finally {
      setPendingActionStopId(null)
    }
  }, [patchStop])

  const handleOnMyWay = useCallback(async (stopId: string, etaMinutes: number) => {
    setPendingActionStopId(stopId)
    try {
      const res = await fetch(`/api/hub/daily-log/stops/${stopId}/on-my-way`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eta_minutes: etaMinutes }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        patchStop(stopId, { _omw_error: data.error || `Failed (${res.status})` })
        return { ok: false as const }
      }
      patchStop(stopId, {
        on_my_way_sent_at: data.stop?.on_my_way_sent_at ?? new Date().toISOString(),
        on_my_way_eta_minutes: data.stop?.on_my_way_eta_minutes ?? etaMinutes,
        _omw_error: null,
      })
      return { ok: true as const }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Send failed'
      patchStop(stopId, { _omw_error: msg })
      return { ok: false as const }
    } finally {
      setPendingActionStopId(null)
    }
  }, [patchStop])

  const handleArrive = useCallback(async (stopId: string, undo: boolean) => {
    setPendingActionStopId(stopId)
    try {
      const res = await fetch(`/api/hub/daily-log/stops/${stopId}/arrive`, {
        method: undo ? 'DELETE' : 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || `Failed (${res.status})`)
      }
      patchStop(stopId, {
        status: data.stop?.status,
        arrived_at: data.stop?.arrived_at ?? null,
        completed_at: data.stop?.completed_at ?? null,
        _jobber_warning: null,
      })
    } catch (e) {
      patchStop(stopId, {
        _jobber_warning: e instanceof Error ? e.message : 'Action failed',
      })
    } finally {
      setPendingActionStopId(null)
    }
  }, [patchStop])

  const handleNotesSave = useCallback(async (stopId: string, notes: string) => {
    try {
      const res = await fetch(`/api/hub/daily-log/stops/${stopId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || `Failed (${res.status})`)
      }
      patchStop(stopId, { notes: data.stop?.notes ?? notes })
      return { ok: true as const }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Save failed' }
    }
  }, [patchStop])

  const load = useCallback(async (d: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/hub/daily-log-v2?date=${d}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Failed (${res.status})`)
      }
      const data = (await res.json()) as ApiResponse
      setEntries(data.entries ?? [])
      setDepot(data.depot ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(date)
  }, [date, load])

  const visibleEntries = useMemo(() => {
    if (filter === 'all') return entries
    return entries.filter(e =>
      e.tech?.id === currentUserId ||
      e.secondary_techs.some(t => t.id === currentUserId),
    )
  }, [entries, filter, currentUserId])

  return (
    <div className="flex flex-col h-full">
      {/* Header — stays fixed at top while content scrolls below */}
      <header className="flex-none px-3 md:px-6 pt-4 pb-3 border-b border-gray-800">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-xl md:text-2xl font-semibold text-white">Daily Log v2</h1>
            <span className="text-[10px] md:text-xs bg-violet-500/20 text-violet-200 px-2 py-0.5 rounded">Preview</span>
          </div>
          <p className="text-xs md:text-sm text-gray-400 hidden md:block">
            Tech-facing view of each day&apos;s stops. Populated by the Route Optimizer&apos;s <strong>Send to Daily Log</strong> button.
          </p>

          {/* Date + filter row */}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setDate(offsetDate(date, -1))}
                className="px-3 py-2 md:py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm text-white min-w-[40px]"
                title="Previous day"
              >
                ←
              </button>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-3 py-2 md:py-1.5 text-base md:text-sm text-white"
              />
              <button
                onClick={() => setDate(offsetDate(date, 1))}
                className="px-3 py-2 md:py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm text-white min-w-[40px]"
                title="Next day"
              >
                →
              </button>
              {date !== todayStr() && (
                <button
                  onClick={() => setDate(todayStr())}
                  className="px-3 py-2 md:py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm text-white"
                >
                  Today
                </button>
              )}
            </div>
            <div className="ml-auto flex items-center gap-1 bg-gray-800 border border-gray-700 rounded p-0.5">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 md:py-1 rounded text-sm ${filter === 'all' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                All
              </button>
              <button
                onClick={() => setFilter('mine')}
                className={`px-3 py-1.5 md:py-1 rounded text-sm ${filter === 'mine' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                My Day
              </button>
            </div>
          </div>
          <div className="text-xs text-gray-400 mt-2">
            {formatDateHeading(date)}
          </div>
        </div>
      </header>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-5xl mx-auto px-3 md:px-6 py-4 pb-24">
          {loading && <div className="text-gray-500 text-sm">Loading…</div>}
          {error && (
            <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm mb-4">
              {error}
            </div>
          )}

          {!loading && !error && visibleEntries.length === 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 md:p-8 text-center">
              <p className="text-gray-400 mb-2">No entries for {formatDateHeading(date)}.</p>
              <p className="text-sm text-gray-500">
                Run the <a href="/hub/routing" className="text-sky-400 hover:underline">Route Optimizer</a> and click
                {' '}<strong>Send to Daily Log</strong> to populate stops here.
              </p>
            </div>
          )}

          <div className="space-y-4 md:space-y-6">
            {visibleEntries.map(entry => (
              <EntryCard
                key={entry.id}
                entry={entry}
                depot={depot}
                isAdmin={isAdmin}
                mapHeight={isMobile ? 240 : 360}
                expandedStopId={expandedStopId}
                pendingActionStopId={pendingActionStopId}
                onToggleExpand={handleToggleExpand}
                onArrive={handleArrive}
                onComplete={handleComplete}
                onNotesSave={handleNotesSave}
                onOnMyWay={handleOnMyWay}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function EntryCard({
  entry,
  depot,
  isAdmin,
  mapHeight,
  expandedStopId,
  pendingActionStopId,
  onToggleExpand,
  onArrive,
  onComplete,
  onNotesSave,
  onOnMyWay,
}: {
  entry: Entry
  depot: { lat: number; lng: number } | null
  isAdmin: boolean
  mapHeight: number
  expandedStopId: string | null
  pendingActionStopId: string | null
  onToggleExpand: (stopId: string) => void
  onArrive: (stopId: string, undo: boolean) => void | Promise<void>
  onComplete: (stopId: string, undo: boolean) => void | Promise<void>
  onNotesSave: (stopId: string, notes: string) => Promise<{ ok: true } | { ok: false; error: string }>
  onOnMyWay: (stopId: string, etaMinutes: number) => Promise<{ ok: true } | { ok: false }>
}) {
  const stopsWithCoords = entry.stops.filter(s => s.lat != null && s.lng != null)
  const hasMap = stopsWithCoords.length > 0

  const pins: RoutePreviewPin[] = stopsWithCoords.map(s => ({
    id: s.id,
    lat: s.lat!,
    lng: s.lng!,
    label: pinLabel(s.ord),
    color: s.status === 'complete' ? '888888' : 'c0392b',
    title: `${s.ord}. ${s.client_name}`,
  }))

  const isCompleted = entry.completed_at != null
  const isClosed = entry.closed_at != null
  const totalStops = entry.stops.length
  const completedStops = entry.stops.filter(s => s.status === 'complete').length

  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden ${isClosed ? 'opacity-60' : ''}`}>
      {/* Header */}
      <div className="px-4 md:px-5 py-3 md:py-4 border-b border-gray-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <UserAvatar user={entry.tech} />
          <div className="min-w-0">
            <div className="font-semibold text-white truncate">
              {entry.tech?.display_name ?? 'Unknown tech'}
            </div>
            {entry.secondary_techs.length > 0 && (
              <div className="text-xs text-gray-400 truncate">
                + {entry.secondary_techs.map(t => t.display_name).join(', ')}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-none">
          {totalStops > 0 && (
            <span className="text-xs text-gray-300 bg-gray-800 px-2 py-1 rounded">
              {completedStops}/{totalStops} done
            </span>
          )}
          {isCompleted && (
            <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-1 rounded">
              ✓ Route Completed
            </span>
          )}
          {isClosed && (
            <span className="text-xs bg-sky-500/20 text-sky-300 px-2 py-1 rounded">
              Closed
            </span>
          )}
        </div>
      </div>

      {/* Office instructions */}
      {entry.office_notes && (
        <div className="px-5 py-3 bg-amber-500/5 border-b border-gray-800">
          <div className="text-xs font-medium text-amber-300 mb-1">Office Instructions</div>
          <div className="text-sm text-gray-200 whitespace-pre-wrap">{entry.office_notes}</div>
        </div>
      )}

      {/* Map */}
      {hasMap && (
        <div className="border-b border-gray-800">
          <RoutePreviewMap
            depotCoord={depot}
            pins={pins}
            drawDrivePath={true}
            height={mapHeight}
          />
        </div>
      )}

      {/* Stops list */}
      <div className="divide-y divide-gray-800">
        {entry.stops.length === 0 ? (
          <div className="px-5 py-6 text-sm text-gray-500 text-center">
            No stops attached yet. Send a route from the Route Optimizer to populate.
          </div>
        ) : (
          entry.stops.map(s => (
            <StopRow
              key={s.id}
              stop={s}
              expanded={expandedStopId === s.id}
              pending={pendingActionStopId === s.id}
              onToggleExpand={onToggleExpand}
              onArrive={onArrive}
              onComplete={onComplete}
              onNotesSave={onNotesSave}
              onOnMyWay={onOnMyWay}
            />
          ))
        )}
      </div>

      {/* Route sheet link if uploaded */}
      {entry.route_sheet_url && (
        <div className="px-5 py-3 bg-gray-900/50 border-t border-gray-800 text-xs">
          <a
            href={entry.route_sheet_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-400 hover:underline"
          >
            📎 {entry.route_sheet_name ?? 'Route Sheet'}
          </a>
        </div>
      )}

      {isAdmin && (
        <div className="px-5 py-2 bg-gray-900/30 border-t border-gray-800 text-[10px] text-gray-600 uppercase tracking-wide">
          v2 preview — Phases 1–5 live (foundation, complete→Jobber, timer, On-My-Way, weather, pesticide records)
        </div>
      )}
    </div>
  )
}

function formatPhone(p: string): string {
  // Strip non-digits, format as (XXX) XXX-XXXX for US 10-digit numbers
  const digits = p.replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith('1')) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return p
}

function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`
}

// Formats a duration in milliseconds as "Xh Ym" / "Xm Ys" / "Ys"
function formatDuration(ms: number): string {
  if (ms < 0) ms = 0
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`
  return `${s}s`
}

function StopRow({
  stop,
  expanded,
  pending,
  onToggleExpand,
  onArrive,
  onComplete,
  onNotesSave,
  onOnMyWay,
}: {
  stop: Stop
  expanded: boolean
  pending: boolean
  onToggleExpand: (stopId: string) => void
  onArrive: (stopId: string, undo: boolean) => void | Promise<void>
  onComplete: (stopId: string, undo: boolean) => void | Promise<void>
  onNotesSave: (stopId: string, notes: string) => Promise<{ ok: true } | { ok: false; error: string }>
  onOnMyWay: (stopId: string, etaMinutes: number) => Promise<{ ok: true } | { ok: false }>
}) {
  const lineItemNames = stop.line_items.map(li => li.name).filter(Boolean)
  const lineItemsSummary = lineItemNames.length === 0
    ? null
    : lineItemNames.length <= 2
      ? lineItemNames.join(' · ')
      : `${lineItemNames.slice(0, 2).join(' · ')} +${lineItemNames.length - 2} more`

  const isComplete = stop.status === 'complete'
  const isInProgress = stop.status === 'in_progress'

  // On-My-Way picker state — toggled by the OMW button.
  const [omwPickerOpen, setOmwPickerOpen] = useState(false)
  const [omwEta, setOmwEta] = useState<number>(15)
  const [omwCustom, setOmwCustom] = useState<string>('')

  // Live ticking timer — only ticks when in_progress AND expanded.
  // Re-renders once per second; lightweight (one stop expanded at a time).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expanded || !isInProgress || !stop.arrived_at) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [expanded, isInProgress, stop.arrived_at])

  // Local notes state — synced from server but edited locally; save on blur.
  const [notesDraft, setNotesDraft] = useState(stop.notes ?? '')
  const [notesStatus, setNotesStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [notesError, setNotesError] = useState<string | null>(null)

  // Reset draft when the underlying server-state notes value changes (e.g.
  // after another device updates). Only reset if no unsaved local edit.
  useEffect(() => {
    setNotesDraft(prev => (notesStatus === 'idle' ? (stop.notes ?? '') : prev))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop.notes])

  async function saveNotes() {
    if ((notesDraft ?? '') === (stop.notes ?? '')) return
    setNotesStatus('saving')
    setNotesError(null)
    const result = await onNotesSave(stop.id, notesDraft)
    if (result.ok) {
      setNotesStatus('saved')
      setTimeout(() => setNotesStatus('idle'), 1500)
    } else {
      setNotesStatus('error')
      setNotesError(result.error)
    }
  }

  const lineItemTotal = stop.line_items.reduce((s, li) => s + (li.totalPrice ?? 0), 0)

  const navHref = stop.address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}`
    : null

  async function submitOmw() {
    const eta = omwCustom ? parseInt(omwCustom, 10) : omwEta
    if (!Number.isFinite(eta) || eta < 1 || eta > 240) return
    const result = await onOnMyWay(stop.id, eta)
    if (result.ok) {
      setOmwPickerOpen(false)
      setOmwCustom('')
    }
  }

  return (
    <div>
      {/* Compact row — entire button toggles expansion */}
      <button
        onClick={() => onToggleExpand(stop.id)}
        className={`w-full text-left px-4 md:px-5 py-3 flex items-start gap-3 hover:bg-gray-800/40 transition-colors ${
          isComplete ? 'opacity-60' : ''
        } ${expanded ? 'bg-gray-800/30' : ''}`}
      >
        <div
          className={`w-8 h-8 rounded-full flex-none flex items-center justify-center text-sm font-semibold ${
            isComplete ? 'bg-emerald-700 text-emerald-100'
            : isInProgress ? 'bg-amber-500 text-amber-50'
            : 'bg-red-900/40 text-red-300'
          }`}
        >
          {isComplete ? '✓' : pinLabel(stop.ord)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`font-medium ${isComplete ? 'text-gray-400 line-through' : 'text-white'}`}>{stop.client_name}</div>
            {stop.scheduled_start_at && (
              <div className="text-xs text-gray-400">{formatTime(stop.scheduled_start_at)}</div>
            )}
            {stop.duration_minutes && !isComplete && (
              <div className="text-xs text-gray-500">~{stop.duration_minutes} min</div>
            )}
            {stop.on_my_way_sent_at && !isComplete && (
              <div className="text-[10px] bg-sky-500/15 text-sky-300 px-1.5 py-0.5 rounded">
                💬 {formatTime(stop.on_my_way_sent_at)}
              </div>
            )}
          </div>
          <div className="text-sm text-gray-400 truncate">{stop.address}</div>
          {stop.job_title && !expanded && (
            <div className="text-xs text-gray-500 mt-0.5">{stop.job_title}</div>
          )}
          {lineItemsSummary && !expanded && (
            <div className="text-xs text-gray-500 mt-0.5">{lineItemsSummary}</div>
          )}
        </div>
        <div className="flex-none self-center text-gray-500 text-lg">
          {expanded ? '▾' : '▸'}
        </div>
      </button>

      {/* Detail panel — only when expanded */}
      {expanded && (
        <div className="px-4 md:px-5 pb-4 pt-1 bg-gray-800/20 border-t border-gray-800/50 space-y-3 text-sm">
          {/* Contact */}
          {stop.client_phone && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Contact</div>
              <a
                href={`tel:${stop.client_phone}`}
                onClick={e => e.stopPropagation()}
                className="text-sky-400 hover:underline"
              >
                📞 {formatPhone(stop.client_phone)}
              </a>
            </div>
          )}

          {/* Approach actions — Navigate + On My Way */}
          <div className="grid grid-cols-2 gap-2">
            {navHref ? (
              <a
                href={navHref}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded font-medium text-sm text-center transition-colors flex items-center justify-center gap-1.5"
              >
                🗺️ Navigate
              </a>
            ) : (
              <button
                disabled
                className="px-3 py-2.5 bg-gray-800 text-gray-500 rounded font-medium text-sm cursor-not-allowed"
              >
                🗺️ No address
              </button>
            )}
            {stop.client_phone ? (
              <button
                onClick={() => setOmwPickerOpen(v => !v)}
                disabled={pending}
                className={`px-3 py-2.5 rounded font-medium text-sm transition-colors flex items-center justify-center gap-1.5 ${
                  stop.on_my_way_sent_at
                    ? 'bg-sky-500/20 text-sky-200 hover:bg-sky-500/30'
                    : 'bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50'
                }`}
              >
                {stop.on_my_way_sent_at
                  ? `💬 Sent ${formatTime(stop.on_my_way_sent_at)}${stop.on_my_way_eta_minutes ? ` · ${stop.on_my_way_eta_minutes}m` : ''}`
                  : '💬 On My Way'}
              </button>
            ) : (
              <button
                disabled
                className="px-3 py-2.5 bg-gray-800 text-gray-500 rounded font-medium text-sm cursor-not-allowed"
              >
                💬 No phone
              </button>
            )}
          </div>

          {/* On-My-Way ETA picker (inline reveal) */}
          {omwPickerOpen && stop.client_phone && (
            <div className="bg-amber-500/5 border border-amber-500/30 rounded p-3 space-y-3">
              <div className="text-xs text-amber-200">
                How many minutes away?
              </div>
              <div className="flex flex-wrap gap-2">
                {[5, 10, 15, 20, 30, 45].map(n => (
                  <button
                    key={n}
                    onClick={() => { setOmwEta(n); setOmwCustom('') }}
                    className={`px-3 py-2 rounded text-sm font-medium transition-colors min-w-[52px] ${
                      (!omwCustom && omwEta === n)
                        ? 'bg-amber-500 text-white'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    {n}m
                  </button>
                ))}
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={240}
                  value={omwCustom}
                  onChange={e => setOmwCustom(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="Custom"
                  className="w-20 bg-gray-900 border border-gray-700 rounded px-2 py-2 text-base md:text-sm text-white placeholder-gray-500 outline-none focus:border-amber-500"
                />
              </div>

              {stop._omw_error && (
                <div className="text-xs text-red-300">⚠ {stop._omw_error}</div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={submitOmw}
                  disabled={pending}
                  className="flex-1 px-3 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded font-semibold text-sm transition-colors"
                >
                  {pending ? 'Sending…' : `Send (${omwCustom || omwEta} min ETA)`}
                </button>
                <button
                  onClick={() => { setOmwPickerOpen(false); setOmwCustom('') }}
                  disabled={pending}
                  className="px-3 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Job title */}
          {stop.job_title && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Job</div>
              <div className="text-gray-200">{stop.job_title}</div>
            </div>
          )}

          {/* Line items */}
          {stop.line_items.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Line items</div>
              <div className="bg-gray-900/40 rounded border border-gray-800 overflow-hidden">
                <table className="w-full text-xs">
                  <tbody>
                    {stop.line_items.map((li, i) => (
                      <tr key={i} className="border-b border-gray-800 last:border-b-0">
                        <td className="px-2 py-1.5 text-gray-200">{li.name}</td>
                        <td className="px-2 py-1.5 text-right text-gray-400 w-12">{li.qty}×</td>
                        <td className="px-2 py-1.5 text-right text-gray-200 w-20">{formatMoney(li.totalPrice ?? 0)}</td>
                      </tr>
                    ))}
                    {lineItemTotal > 0 && (
                      <tr className="bg-gray-900/60">
                        <td className="px-2 py-1.5 text-right text-gray-400 text-[10px] uppercase tracking-wide" colSpan={2}>Total</td>
                        <td className="px-2 py-1.5 text-right text-white font-medium">{formatMoney(lineItemTotal)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Visit instructions */}
          {stop.instructions && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-amber-300 mb-1">Visit instructions</div>
              <div className="bg-amber-500/5 border border-amber-500/20 rounded px-2.5 py-2 text-gray-200 whitespace-pre-wrap">
                {stop.instructions}
              </div>
            </div>
          )}

          {/* Tech notes */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">My notes</div>
              <div className="text-[10px] text-gray-500 h-3">
                {notesStatus === 'saving' && 'Saving…'}
                {notesStatus === 'saved' && <span className="text-emerald-400">✓ Saved</span>}
                {notesStatus === 'error' && <span className="text-red-400">⚠ {notesError}</span>}
              </div>
            </div>
            <textarea
              value={notesDraft}
              onChange={e => {
                setNotesDraft(e.target.value)
                if (notesStatus !== 'idle') setNotesStatus('idle')
              }}
              onBlur={saveNotes}
              placeholder="Notes from this stop (saves when you tap away)"
              rows={2}
              className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-2 text-base md:text-sm text-white placeholder-gray-500 outline-none focus:border-sky-500 resize-y min-h-[60px]"
            />
          </div>

          {/* Jobber warning (if a Complete/Reopen call had an issue) */}
          {stop._jobber_warning && (
            <div className="bg-amber-900/30 border border-amber-700/50 text-amber-200 rounded px-2.5 py-2 text-xs">
              ⚠ {stop._jobber_warning}
            </div>
          )}

          {/* Time on property — live timer / arrival info / final duration */}
          <div className="bg-gray-900/40 border border-gray-800 rounded px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Time on property</div>
            {isComplete && stop.arrived_at && stop.completed_at && (
              <div className="text-gray-200">
                <span className="font-medium">{formatDuration(new Date(stop.completed_at).getTime() - new Date(stop.arrived_at).getTime())}</span>
                <span className="text-gray-500 text-xs ml-2">
                  {formatTime(stop.arrived_at)} – {formatTime(stop.completed_at)}
                </span>
              </div>
            )}
            {isComplete && (!stop.arrived_at || !stop.completed_at) && (
              <div className="text-gray-500 text-xs">
                {stop.completed_at ? `Completed at ${formatTime(stop.completed_at)} (no arrival time recorded)` : 'No timestamps'}
              </div>
            )}
            {isInProgress && stop.arrived_at && (
              <div className="text-gray-200">
                <span className="font-mono text-lg font-semibold text-amber-300">
                  {formatDuration(now - new Date(stop.arrived_at).getTime())}
                </span>
                <span className="text-gray-500 text-xs ml-2">
                  since {formatTime(stop.arrived_at)}
                </span>
              </div>
            )}
            {!isComplete && !isInProgress && (
              <div className="text-gray-500 text-xs">
                Not started — tap <strong>Arrived</strong> below to start the timer.
              </div>
            )}
          </div>

          {/* Weather snapshot — captured at Mark Complete via NWS api.weather.gov.
              Only renders for completed stops with a captured snapshot. */}
          {isComplete && stop.weather && (
            <div className="bg-gray-900/40 border border-gray-800 rounded px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Weather at completion</div>
              <div className="text-gray-200 text-sm">
                {typeof stop.weather.temperature_f === 'number' && (
                  <span className="font-medium">{stop.weather.temperature_f}°F</span>
                )}
                {stop.weather.conditions && (
                  <span className="text-gray-400">
                    {typeof stop.weather.temperature_f === 'number' ? ' · ' : ''}
                    {stop.weather.conditions}
                  </span>
                )}
              </div>
              {(typeof stop.weather.wind_mph === 'number' || typeof stop.weather.humidity_pct === 'number') && (
                <div className="text-gray-500 text-xs mt-0.5">
                  {typeof stop.weather.wind_mph === 'number' && (
                    <span>Wind {stop.weather.wind_mph} mph</span>
                  )}
                  {typeof stop.weather.wind_mph === 'number' && typeof stop.weather.humidity_pct === 'number' && ' · '}
                  {typeof stop.weather.humidity_pct === 'number' && (
                    <span>Humidity {stop.weather.humidity_pct}%</span>
                  )}
                </div>
              )}
              {stop.weather.station_name && (
                <div className="text-gray-600 text-[10px] mt-0.5">
                  Source: NWS · {stop.weather.station_name}
                </div>
              )}
            </div>
          )}

          {/* Pesticide-record link — present when matching mappings produced
              a TDA-compliance record. Always shown for any stop with a record,
              including reopened stops (records persist across reopen). */}
          {stop.pesticide_record_id && (
            <a
              href={`/hub/pesticide-records/${stop.pesticide_record_id}`}
              onClick={e => e.stopPropagation()}
              className="block bg-emerald-500/5 border border-emerald-500/30 rounded px-3 py-2 text-xs text-emerald-200 hover:bg-emerald-500/10 transition-colors"
            >
              🧪 Pesticide record on file →
            </a>
          )}

          {/* Jobber warning (if a Complete/Reopen call had an issue) */}
          {stop._jobber_warning && (
            <div className="bg-amber-900/30 border border-amber-700/50 text-amber-200 rounded px-2.5 py-2 text-xs">
              ⚠ {stop._jobber_warning}
            </div>
          )}

          {/* Action buttons — state machine */}
          <div className="pt-1 space-y-2">
            {!isComplete && !isInProgress && (
              <>
                <button
                  onClick={() => onArrive(stop.id, false)}
                  disabled={pending}
                  className="w-full px-3 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white rounded font-semibold text-base transition-colors"
                >
                  {pending ? 'Starting…' : '▶ Arrived at property'}
                </button>
                <button
                  onClick={() => onComplete(stop.id, false)}
                  disabled={pending}
                  className="w-full px-3 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded font-medium text-sm transition-colors"
                >
                  {pending ? 'Marking complete…' : '✓ Mark Complete (skip timer)'}
                </button>
              </>
            )}

            {isInProgress && (
              <>
                <button
                  onClick={() => onComplete(stop.id, false)}
                  disabled={pending}
                  className="w-full px-3 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded font-semibold text-base transition-colors"
                >
                  {pending ? 'Marking complete…' : '✓ Mark Complete'}
                </button>
                <button
                  onClick={() => onArrive(stop.id, true)}
                  disabled={pending}
                  className="w-full px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                >
                  ↺ Reset arrival time
                </button>
              </>
            )}

            {isComplete && (
              <button
                onClick={() => onComplete(stop.id, true)}
                disabled={pending}
                className="w-full px-3 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded font-medium text-sm transition-colors"
              >
                {pending ? 'Reopening…' : '↩ Reopen this stop'}
              </button>
            )}

            {stop.jobber_visit_id && (
              <p className="text-[10px] text-gray-500 text-center">
                {isComplete ? 'Reopening also flips the visit back in Jobber.' : !isInProgress ? 'Mark Complete also marks the visit done in Jobber.' : 'Mark Complete also marks the visit done in Jobber.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
