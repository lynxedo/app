'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import RoutePreviewMap, { type RoutePreviewPin } from '@/components/RoutePreviewMap'

// ── Types ────────────────────────────────────────────────────────────────────

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
  skip_reason_id: string | null
  skip_reason_label: string | null
  pesticide_tech_notes: string | null
  office_reviewed_at: string | null
  office_reviewed_by: string | null
  // Transient client-side state — not stored on server
  _jobber_warning?: string | null
  _omw_error?: string | null
}

type SkipReason = { id: string; label: string; sort_order: number }

type StopMessage = {
  id: string
  content: string
  created_at: string
  user: { id: string; display_name: string; avatar_url?: string | null } | null
}

type StopAttachment = {
  id: string
  file_name: string
  file_type: string | null
  file_size: number | null
  file_url: string
  created_at: string
  uploaded_by: string | null
}

type ServiceReport = {
  id: string
  main_service: string | null
  additional_services: string[]
  issues_found: string[]
  notes: string | null
  sent_at: string | null
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

// ── Constants ─────────────────────────────────────────────────────────────────

const MAIN_SERVICE_OPTIONS = [
  'Lawn Mowing',
  'Lawn Treatment',
  'Fertilization',
  'Weed Control',
  'Aeration',
  'Irrigation Service',
  'Landscaping',
  'Cleanup',
  'Other',
]

const ADDITIONAL_SERVICE_OPTIONS = [
  'Edging',
  'Blowing',
  'Trimming',
  'Bagging',
  'Mulching',
  'Pruning',
  'Bed maintenance',
]

const ISSUE_OPTIONS = [
  'Irrigation leak detected',
  'Sprinkler head damage',
  'Lawn disease spotted',
  'Pest activity noted',
  'Gate access issue',
  'Property damage observed',
  'Overgrowth needs attention',
]

// ── Utilities ─────────────────────────────────────────────────────────────────

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

function formatPhone(p: string): string {
  const digits = p.replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith('1')) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return p
}

function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`
}

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

// ── UserAvatar ────────────────────────────────────────────────────────────────

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

// ── Main component ────────────────────────────────────────────────────────────

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
  const [skipReasons, setSkipReasons] = useState<SkipReason[]>([])
  const [routeCompleteEntryId, setRouteCompleteEntryId] = useState<string | null>(null)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    fetch('/api/hub/daily-log/skip-reasons')
      .then(r => r.json())
      .then(d => setSkipReasons(d.reasons ?? []))
      .catch(() => {/* non-critical */})
  }, [])

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

  const handleComplete = useCallback(async (stopId: string, undo: boolean, entryId: string) => {
    setPendingActionStopId(stopId)
    try {
      const res = await fetch(`/api/hub/daily-log/stops/${stopId}/complete`, {
        method: undo ? 'DELETE' : 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`)
      const patch: Partial<Stop> = {
        status: data.stop?.status,
        arrived_at: data.stop?.arrived_at ?? null,
        completed_at: data.stop?.completed_at ?? null,
        _jobber_warning: data.jobber_warning ?? null,
      }
      if (data.stop && 'weather' in data.stop) patch.weather = data.stop.weather ?? null
      if (data.stop && 'pesticide_record_id' in data.stop) patch.pesticide_record_id = data.stop.pesticide_record_id ?? null
      patchStop(stopId, patch)
      if (!undo && data.is_last_stop) setRouteCompleteEntryId(entryId)
    } catch (e) {
      patchStop(stopId, { _jobber_warning: e instanceof Error ? e.message : 'Action failed' })
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
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`)
      patchStop(stopId, {
        status: data.stop?.status,
        arrived_at: data.stop?.arrived_at ?? null,
        completed_at: data.stop?.completed_at ?? null,
        weather: data.stop?.weather ?? null,
        _jobber_warning: null,
      })
    } catch (e) {
      patchStop(stopId, { _jobber_warning: e instanceof Error ? e.message : 'Action failed' })
    } finally {
      setPendingActionStopId(null)
    }
  }, [patchStop])

  const handleSkip = useCallback(async (stopId: string, undo: boolean, reasonId?: string, reasonLabel?: string) => {
    setPendingActionStopId(stopId)
    try {
      const res = await fetch(`/api/hub/daily-log/stops/${stopId}/skip`, {
        method: undo ? 'DELETE' : 'POST',
        ...(undo ? {} : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skip_reason_id: reasonId ?? null, skip_reason_label: reasonLabel ?? null }),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`)
      patchStop(stopId, {
        status: data.stop?.status,
        arrived_at: data.stop?.arrived_at ?? null,
        skip_reason_id: data.stop?.skip_reason_id ?? null,
        skip_reason_label: data.stop?.skip_reason_label ?? null,
        _jobber_warning: null,
      })
    } catch (e) {
      patchStop(stopId, { _jobber_warning: e instanceof Error ? e.message : 'Skip failed' })
    } finally {
      setPendingActionStopId(null)
    }
  }, [patchStop])

  const handleMarkRouteComplete = useCallback(async (entryId: string) => {
    try {
      const res = await fetch(`/api/hub/daily-log/${entryId}/complete`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setEntries(prev => prev.map(e => e.id === entryId
          ? { ...e, completed_at: data.entry?.completed_at ?? new Date().toISOString() }
          : e,
        ))
      }
    } catch {/* best effort */} finally {
      setRouteCompleteEntryId(null)
    }
  }, [])

  const handlePestNotesSave = useCallback(async (stopId: string, notes: string) => {
    try {
      const res = await fetch(`/api/hub/daily-log/stops/${stopId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pesticide_tech_notes: notes }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`)
      patchStop(stopId, { pesticide_tech_notes: data.stop?.pesticide_tech_notes ?? notes })
      return { ok: true as const }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Save failed' }
    }
  }, [patchStop])

  const handleReview = useCallback(async (stopId: string, undo: boolean) => {
    try {
      const res = await fetch(`/api/hub/daily-log/stops/${stopId}/review`, {
        method: undo ? 'DELETE' : 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return
      patchStop(stopId, {
        office_reviewed_at: data.stop?.office_reviewed_at ?? null,
        office_reviewed_by: data.stop?.office_reviewed_by ?? null,
      })
    } catch {/* best effort */}
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
      patchStop(stopId, { _omw_error: e instanceof Error ? e.message : 'Send failed' })
      return { ok: false as const }
    } finally {
      setPendingActionStopId(null)
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
      <header className="flex-none px-3 md:px-6 pt-4 pb-3 border-b border-gray-800">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-xl md:text-2xl font-semibold text-white">Daily Log v2</h1>
            <span className="text-[10px] md:text-xs bg-violet-500/20 text-violet-200 px-2 py-0.5 rounded">Preview</span>
          </div>
          <p className="text-xs md:text-sm text-gray-400 hidden md:block">
            Tech-facing view of each day&apos;s stops. Populated by the Route Optimizer&apos;s <strong>Send to Daily Log</strong> button.
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setDate(offsetDate(date, -1))}
                className="px-3 py-2 md:py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm text-white min-w-[40px]"
              >←</button>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-3 py-2 md:py-1.5 text-base md:text-sm text-white"
              />
              <button
                onClick={() => setDate(offsetDate(date, 1))}
                className="px-3 py-2 md:py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm text-white min-w-[40px]"
              >→</button>
              {date !== todayStr() && (
                <button
                  onClick={() => setDate(todayStr())}
                  className="px-3 py-2 md:py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm text-white"
                >Today</button>
              )}
            </div>
            <div className="ml-auto flex items-center gap-1 bg-gray-800 border border-gray-700 rounded p-0.5">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 md:py-1 rounded text-sm ${filter === 'all' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >All</button>
              <button
                onClick={() => setFilter('mine')}
                className={`px-3 py-1.5 md:py-1 rounded text-sm ${filter === 'mine' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >My Day</button>
            </div>
          </div>
          <div className="text-xs text-gray-400 mt-2">{formatDateHeading(date)}</div>
        </div>
      </header>

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
                Run the <a href="/hub/routing" className="text-sky-400 hover:underline">Route Optimizer</a> and click{' '}
                <strong>Send to Daily Log</strong> to populate stops here.
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
                currentUserId={currentUserId}
                mapHeight={isMobile ? 240 : 360}
                expandedStopId={expandedStopId}
                pendingActionStopId={pendingActionStopId}
                skipReasons={skipReasons}
                showRouteCompleteBanner={routeCompleteEntryId === entry.id}
                onToggleExpand={handleToggleExpand}
                onArrive={handleArrive}
                onComplete={(stopId, undo) => handleComplete(stopId, undo, entry.id)}
                onSkip={handleSkip}
                onOnMyWay={handleOnMyWay}
                onPestNotesSave={handlePestNotesSave}
                onReview={handleReview}
                onMarkRouteComplete={handleMarkRouteComplete}
                onDismissRouteComplete={() => setRouteCompleteEntryId(null)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── EntryCard ─────────────────────────────────────────────────────────────────

function EntryCard({
  entry,
  depot,
  isAdmin,
  currentUserId,
  mapHeight,
  expandedStopId,
  pendingActionStopId,
  skipReasons,
  showRouteCompleteBanner,
  onToggleExpand,
  onArrive,
  onComplete,
  onSkip,
  onOnMyWay,
  onPestNotesSave,
  onReview,
  onMarkRouteComplete,
  onDismissRouteComplete,
}: {
  entry: Entry
  depot: { lat: number; lng: number } | null
  isAdmin: boolean
  currentUserId: string
  mapHeight: number
  expandedStopId: string | null
  pendingActionStopId: string | null
  skipReasons: SkipReason[]
  showRouteCompleteBanner: boolean
  onToggleExpand: (stopId: string) => void
  onArrive: (stopId: string, undo: boolean) => void | Promise<void>
  onComplete: (stopId: string, undo: boolean) => void | Promise<void>
  onSkip: (stopId: string, undo: boolean, reasonId?: string, reasonLabel?: string) => void | Promise<void>
  onOnMyWay: (stopId: string, etaMinutes: number) => Promise<{ ok: true } | { ok: false }>
  onPestNotesSave: (stopId: string, notes: string) => Promise<{ ok: true } | { ok: false; error: string }>
  onReview: (stopId: string, undo: boolean) => void | Promise<void>
  onMarkRouteComplete: (entryId: string) => void | Promise<void>
  onDismissRouteComplete: () => void
}) {
  const [officeNotesDraft, setOfficeNotesDraft] = useState(entry.office_notes ?? '')
  const [officeNotesSaving, setOfficeNotesSaving] = useState(false)

  async function saveOfficeNotes() {
    if (officeNotesDraft === (entry.office_notes ?? '')) return
    setOfficeNotesSaving(true)
    try {
      await fetch(`/api/hub/daily-log/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ office_notes: officeNotesDraft.trim() || null }),
      })
    } finally {
      setOfficeNotesSaving(false)
    }
  }

  async function openRouteSheet() {
    // Gesture-safe open (mirrors v1 DailyLogView.openRouteSheet). Open the window
    // synchronously on the trusted click so iOS doesn't block it as a popup, then
    // fetch a token-authorized URL from inside the app (where we're cookie-authed)
    // and navigate the popup to it. The token makes the sheet load in ANY browser
    // the device hands the link to — fixes the 401 the native app hit when
    // target="_blank" opened the system browser without the Lynxedo session cookie.
    const win = window.open('', '_blank')
    const res = await fetch(`/api/hub/daily-log/${entry.id}/route-sheet?grant=1`)
    if (!res.ok) { win?.close(); return }
    const { url } = await res.json()
    if (win) win.location.href = url
  }

  const stopsWithCoords = entry.stops.filter(s => s.lat != null && s.lng != null)
  const hasMap = stopsWithCoords.length > 0

  const pins: RoutePreviewPin[] = stopsWithCoords.map(s => ({
    id: s.id,
    lat: s.lat!,
    lng: s.lng!,
    label: pinLabel(s.ord),
    color: s.status === 'complete'
      ? '888888'
      : s.status === 'skipped'
        ? 'aaaaaa'
        : 'c0392b',
    title: `${s.ord}. ${s.client_name}`,
  }))

  const isCompleted = entry.completed_at != null
  const isClosed = entry.closed_at != null
  const totalStops = entry.stops.length
  const completedStops = entry.stops.filter(s => s.status === 'complete' || s.status === 'skipped').length

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

      {/* Route-complete prompt — appears after the last non-skipped stop is done */}
      {showRouteCompleteBanner && !isCompleted && (
        <div className="px-4 md:px-5 py-3 bg-emerald-500/10 border-b border-emerald-700/40 flex items-center gap-3">
          <div className="flex-1 text-sm text-emerald-200">✓ All stops done — mark route complete?</div>
          <button
            onClick={() => onMarkRouteComplete(entry.id)}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-semibold transition-colors"
          >
            Mark Complete
          </button>
          <button
            onClick={onDismissRouteComplete}
            className="px-3 py-1.5 text-gray-400 hover:text-white text-sm transition-colors"
          >
            Not yet
          </button>
        </div>
      )}

      {/* Office instructions */}
      {isAdmin ? (
        <div className="px-5 py-3 bg-amber-500/5 border-b border-gray-800">
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs font-medium text-amber-300">Office Instructions</div>
            {officeNotesSaving && <div className="text-[10px] text-gray-500">Saving…</div>}
          </div>
          <textarea
            value={officeNotesDraft}
            onChange={e => setOfficeNotesDraft(e.target.value)}
            onBlur={saveOfficeNotes}
            placeholder="Add office instructions for this route (saves when you click away)…"
            rows={2}
            className="w-full bg-transparent border border-amber-500/20 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-amber-400/50 resize-y"
          />
        </div>
      ) : entry.office_notes ? (
        <div className="px-5 py-3 bg-amber-500/5 border-b border-gray-800">
          <div className="text-xs font-medium text-amber-300 mb-1">Office Instructions</div>
          <div className="text-sm text-gray-200 whitespace-pre-wrap">{entry.office_notes}</div>
        </div>
      ) : null}

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
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              skipReasons={skipReasons}
              onToggleExpand={onToggleExpand}
              onArrive={onArrive}
              onComplete={onComplete}
              onSkip={onSkip}
              onOnMyWay={onOnMyWay}
              onPestNotesSave={onPestNotesSave}
              onReview={onReview}
            />
          ))
        )}
      </div>

      {/* Route sheet link */}
      {entry.route_sheet_url && (
        <div className="px-5 py-3 bg-gray-900/50 border-t border-gray-800 text-xs">
          <button
            type="button"
            onClick={openRouteSheet}
            className="text-sky-400 hover:underline"
          >
            📎 {entry.route_sheet_name ?? 'Route Sheet'}
          </button>
        </div>
      )}

      {isAdmin && (
        <div className="px-5 py-2 bg-gray-900/30 border-t border-gray-800 text-[10px] text-gray-600 uppercase tracking-wide">
          v2 preview — Phases 1–6 live
        </div>
      )}
    </div>
  )
}

// ── StopRow ───────────────────────────────────────────────────────────────────

function StopRow({
  stop,
  expanded,
  pending,
  currentUserId,
  isAdmin,
  skipReasons,
  onToggleExpand,
  onArrive,
  onComplete,
  onSkip,
  onOnMyWay,
  onPestNotesSave,
  onReview,
}: {
  stop: Stop
  expanded: boolean
  pending: boolean
  currentUserId: string
  isAdmin: boolean
  skipReasons: SkipReason[]
  onToggleExpand: (stopId: string) => void
  onArrive: (stopId: string, undo: boolean) => void | Promise<void>
  onComplete: (stopId: string, undo: boolean) => void | Promise<void>
  onSkip: (stopId: string, undo: boolean, reasonId?: string, reasonLabel?: string) => void | Promise<void>
  onOnMyWay: (stopId: string, etaMinutes: number) => Promise<{ ok: true } | { ok: false }>
  onPestNotesSave: (stopId: string, notes: string) => Promise<{ ok: true } | { ok: false; error: string }>
  onReview: (stopId: string, undo: boolean) => void | Promise<void>
}) {
  const lineItemNames = stop.line_items.map(li => li.name).filter(Boolean)
  const lineItemsSummary = lineItemNames.length === 0
    ? null
    : lineItemNames.length <= 2
      ? lineItemNames.join(' · ')
      : `${lineItemNames.slice(0, 2).join(' · ')} +${lineItemNames.length - 2} more`

  const isComplete = stop.status === 'complete'
  const isInProgress = stop.status === 'in_progress'
  const isSkipped = stop.status === 'skipped'

  const [omwPickerOpen, setOmwPickerOpen] = useState(false)
  const [omwEta, setOmwEta] = useState<number>(15)
  const [omwCustom, setOmwCustom] = useState<string>('')

  const [skipPickerOpen, setSkipPickerOpen] = useState(false)
  const [selectedReasonId, setSelectedReasonId] = useState<string | null>(null)
  const [selectedReasonLabel, setSelectedReasonLabel] = useState<string | null>(null)

  // Pesticide tech notes local state
  const [pestNotesDraft, setPestNotesDraft] = useState(stop.pesticide_tech_notes ?? '')
  const [pestNotesStatus, setPestNotesStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [pestNotesError, setPestNotesError] = useState<string | null>(null)

  useEffect(() => {
    setPestNotesDraft(prev => (pestNotesStatus === 'idle' ? (stop.pesticide_tech_notes ?? '') : prev))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop.pesticide_tech_notes])

  async function savePestNotes() {
    if ((pestNotesDraft ?? '') === (stop.pesticide_tech_notes ?? '')) return
    setPestNotesStatus('saving')
    setPestNotesError(null)
    const result = await onPestNotesSave(stop.id, pestNotesDraft)
    if (result.ok) {
      setPestNotesStatus('saved')
      setTimeout(() => setPestNotesStatus('idle'), 1500)
    } else {
      setPestNotesStatus('error')
      setPestNotesError(result.error)
    }
  }

  // Live timer — only ticks when in_progress AND expanded
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expanded || !isInProgress || !stop.arrived_at) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [expanded, isInProgress, stop.arrived_at])

  const lineItemTotal = stop.line_items.reduce((s, li) => s + (li.totalPrice ?? 0), 0)
  const navHref = stop.address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}`
    : null

  async function submitOmw() {
    const eta = omwCustom ? parseInt(omwCustom, 10) : omwEta
    if (!Number.isFinite(eta) || eta < 1 || eta > 240) return
    const result = await onOnMyWay(stop.id, eta)
    if (result.ok) { setOmwPickerOpen(false); setOmwCustom('') }
  }

  async function submitSkip() {
    await onSkip(stop.id, false, selectedReasonId ?? undefined, selectedReasonLabel ?? undefined)
    setSkipPickerOpen(false)
    setSelectedReasonId(null)
    setSelectedReasonLabel(null)
  }

  return (
    <div>
      {/* Compact row */}
      <button
        onClick={() => onToggleExpand(stop.id)}
        className={`w-full text-left px-4 md:px-5 py-3 flex items-start gap-3 hover:bg-gray-800/40 transition-colors ${
          isComplete || isSkipped ? 'opacity-60' : ''
        } ${expanded ? 'bg-gray-800/30' : ''}`}
      >
        <div
          className={`w-8 h-8 rounded-full flex-none flex items-center justify-center text-sm font-semibold ${
            isComplete
              ? 'bg-emerald-700 text-emerald-100'
              : isSkipped
                ? 'bg-gray-700 text-gray-400'
                : isInProgress
                  ? 'bg-amber-500 text-amber-50'
                  : 'bg-red-900/40 text-red-300'
          }`}
        >
          {isComplete ? '✓' : isSkipped ? '⊘' : pinLabel(stop.ord)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`font-medium ${isComplete || isSkipped ? 'text-gray-400 line-through' : 'text-white'}`}>
              {stop.client_name}
            </div>
            {stop.scheduled_start_at && (
              <div className="text-xs text-gray-400">{formatTime(stop.scheduled_start_at)}</div>
            )}
            {stop.duration_minutes && !isComplete && !isSkipped && (
              <div className="text-xs text-gray-500">~{stop.duration_minutes} min</div>
            )}
            {stop.on_my_way_sent_at && !isComplete && !isSkipped && (
              <div className="text-[10px] bg-sky-500/15 text-sky-300 px-1.5 py-0.5 rounded">
                💬 {formatTime(stop.on_my_way_sent_at)}
              </div>
            )}
            {isSkipped && (
              <div className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">
                {stop.skip_reason_label ?? 'Skipped'}
              </div>
            )}
            {stop.office_reviewed_at && (
              <div className="text-[10px] bg-violet-500/20 text-violet-300 px-1.5 py-0.5 rounded">
                ✓ Reviewed
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

      {/* Detail panel */}
      {expanded && (
        <div className="px-4 md:px-5 pb-4 pt-1 bg-gray-800/20 border-t border-gray-800/50 space-y-3 text-sm">

          {/* Skipped notice */}
          {isSkipped && (
            <div className="bg-gray-800/60 border border-gray-700 rounded px-3 py-2.5 text-sm text-gray-400">
              ⊘ This stop was skipped
              {stop.skip_reason_label && <span className="text-gray-300 ml-1">— {stop.skip_reason_label}</span>}
            </div>
          )}

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

          {/* Navigate + On My Way */}
          {!isSkipped && (
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
                <button disabled className="px-3 py-2.5 bg-gray-800 text-gray-500 rounded font-medium text-sm cursor-not-allowed">
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
                <button disabled className="px-3 py-2.5 bg-gray-800 text-gray-500 rounded font-medium text-sm cursor-not-allowed">
                  💬 No phone
                </button>
              )}
            </div>
          )}

          {/* On-My-Way ETA picker */}
          {omwPickerOpen && stop.client_phone && !isSkipped && (
            <div className="bg-amber-500/5 border border-amber-500/30 rounded p-3 space-y-3">
              <div className="text-xs text-amber-200">How many minutes away?</div>
              <div className="flex flex-wrap gap-2">
                {[5, 10, 15, 20, 30, 45].map(n => (
                  <button
                    key={n}
                    onClick={() => { setOmwEta(n); setOmwCustom('') }}
                    className={`px-3 py-2 rounded text-sm font-medium transition-colors min-w-[52px] ${
                      !omwCustom && omwEta === n
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
              {stop._omw_error && <div className="text-xs text-red-300">⚠ {stop._omw_error}</div>}
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

          {/* Unified notes + attachments thread */}
          <StopNotesAndAttachments stopId={stop.id} currentUserId={currentUserId} />

          {/* Office reviewed marker — admin only */}
          {isAdmin && (
            <div className="flex items-center justify-between bg-violet-500/5 border border-violet-500/20 rounded px-3 py-2">
              <div className="text-xs text-gray-300">
                {stop.office_reviewed_at
                  ? <span className="text-violet-300 font-medium">✓ Reviewed &amp; accounts updated</span>
                  : <span className="text-gray-500">Mark as reviewed / accounts updated</span>}
              </div>
              <button
                onClick={() => onReview(stop.id, !!stop.office_reviewed_at)}
                className={`text-xs px-2.5 py-1.5 rounded font-medium transition-colors ${
                  stop.office_reviewed_at
                    ? 'bg-violet-700/40 text-violet-300 hover:bg-violet-700/60'
                    : 'bg-violet-600 text-white hover:bg-violet-500'
                }`}
              >
                {stop.office_reviewed_at ? 'Undo' : 'Mark reviewed'}
              </button>
            </div>
          )}

          {/* Time on property */}
          {!isSkipped && (
            <div className="bg-gray-900/40 border border-gray-800 rounded px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Time on property</div>
              {isComplete && stop.arrived_at && stop.completed_at && (
                <div className="text-gray-200">
                  <span className="font-medium">
                    {formatDuration(new Date(stop.completed_at).getTime() - new Date(stop.arrived_at).getTime())}
                  </span>
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
                  <span className="text-gray-500 text-xs ml-2">since {formatTime(stop.arrived_at)}</span>
                </div>
              )}
              {!isComplete && !isInProgress && (
                <div className="text-gray-500 text-xs">
                  Not started — tap <strong>Arrived</strong> below to start the timer.
                </div>
              )}
            </div>
          )}

          {/* Weather conditions — shown whenever captured (arrive or complete) */}
          {stop.weather && (
            <div className="bg-gray-900/40 border border-gray-800 rounded px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Weather conditions</div>
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
                  {typeof stop.weather.wind_mph === 'number' && <span>Wind {stop.weather.wind_mph} mph</span>}
                  {typeof stop.weather.wind_mph === 'number' && typeof stop.weather.humidity_pct === 'number' && ' · '}
                  {typeof stop.weather.humidity_pct === 'number' && <span>Humidity {stop.weather.humidity_pct}%</span>}
                </div>
              )}
              {stop.weather.station_name && (
                <div className="text-gray-600 text-[10px] mt-0.5">
                  Source: NWS · {stop.weather.station_name}
                </div>
              )}
            </div>
          )}

          {/* Pesticide record link */}
          {stop.pesticide_record_id && (
            <a
              href={`/hub/pesticide-records/${stop.pesticide_record_id}`}
              onClick={e => e.stopPropagation()}
              className="block bg-emerald-500/5 border border-emerald-500/30 rounded px-3 py-2 text-xs text-emerald-200 hover:bg-emerald-500/10 transition-colors"
            >
              🧪 Pesticide record on file →
            </a>
          )}

          {/* Pesticide tech notes — only shown when a record exists */}
          {stop.pesticide_record_id && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] uppercase tracking-wide text-emerald-500/70">Pesticide application notes</div>
                <div className="text-[10px] text-gray-500 h-3">
                  {pestNotesStatus === 'saving' && 'Saving…'}
                  {pestNotesStatus === 'saved' && <span className="text-emerald-400">✓ Saved</span>}
                  {pestNotesStatus === 'error' && <span className="text-red-400">⚠ {pestNotesError}</span>}
                </div>
              </div>
              <textarea
                value={pestNotesDraft}
                onChange={e => {
                  setPestNotesDraft(e.target.value)
                  if (pestNotesStatus !== 'idle') setPestNotesStatus('idle')
                }}
                onBlur={savePestNotes}
                placeholder="Application notes for TDA records (saves when you tap away)"
                rows={2}
                className="w-full bg-gray-900 border border-emerald-700/30 rounded px-2.5 py-2 text-base md:text-sm text-white placeholder-gray-500 outline-none focus:border-emerald-500 resize-y min-h-[56px]"
              />
            </div>
          )}

          {/* After-service report — only for completed stops */}
          {isComplete && (
            <ServiceReportSection stopId={stop.id} clientPhone={stop.client_phone} />
          )}

          {/* Jobber warning */}
          {stop._jobber_warning && (
            <div className="bg-amber-900/30 border border-amber-700/50 text-amber-200 rounded px-2.5 py-2 text-xs">
              ⚠ {stop._jobber_warning}
            </div>
          )}

          {/* Action buttons */}
          <div className="pt-1 space-y-2">
            {!isComplete && !isInProgress && !isSkipped && (
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
                <button
                  onClick={() => { setSkipPickerOpen(v => !v); setSelectedReasonId(null); setSelectedReasonLabel(null) }}
                  disabled={pending}
                  className="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 rounded font-medium text-sm transition-colors"
                >
                  ⊘ Skip this stop
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
                  onClick={() => { setSkipPickerOpen(v => !v); setSelectedReasonId(null); setSelectedReasonLabel(null) }}
                  disabled={pending}
                  className="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 rounded font-medium text-sm transition-colors"
                >
                  ⊘ Skip this stop
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

            {isSkipped && (
              <button
                onClick={() => onSkip(stop.id, true)}
                disabled={pending}
                className="w-full px-3 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded font-medium text-sm transition-colors"
              >
                {pending ? 'Undoing…' : '↩ Undo skip'}
              </button>
            )}

            {/* Skip picker — inline reveal */}
            {skipPickerOpen && !isComplete && !isSkipped && (
              <div className="bg-gray-900/70 border border-gray-700 rounded p-3 space-y-2">
                <div className="text-xs text-gray-400 mb-1.5">Why is this stop being skipped?</div>
                {skipReasons.length === 0 ? (
                  <div className="text-xs text-gray-500">No reason codes configured. Contact your admin.</div>
                ) : (
                  skipReasons.map(r => (
                    <button
                      key={r.id}
                      onClick={() => { setSelectedReasonId(r.id); setSelectedReasonLabel(r.label) }}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                        selectedReasonId === r.id
                          ? 'bg-gray-600 text-white'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={submitSkip}
                    disabled={pending || (skipReasons.length > 0 && !selectedReasonId)}
                    className="flex-1 px-3 py-2.5 bg-gray-600 hover:bg-gray-500 disabled:opacity-40 text-white rounded text-sm font-medium transition-colors"
                  >
                    {pending ? 'Skipping…' : 'Skip stop'}
                  </button>
                  <button
                    onClick={() => setSkipPickerOpen(false)}
                    className="px-3 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {stop.jobber_visit_id && !isSkipped && (
              <p className="text-[10px] text-gray-500 text-center">
                {isComplete
                  ? 'Reopening also flips the visit back in Jobber.'
                  : 'Mark Complete also marks the visit done in Jobber.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── StopNotesAndAttachments ───────────────────────────────────────────────────

type ThreadItem =
  | { kind: 'message'; id: string; content: string; created_at: string; user: StopMessage['user'] }
  | { kind: 'file'; id: string; file_name: string; file_type: string | null; file_size: number | null; file_url: string; created_at: string; uploaded_by: string | null }

type PendingFile = { file: File; previewUrl: string | null }

function StopNotesAndAttachments({
  stopId,
  currentUserId,
}: {
  stopId: string
  currentUserId: string
}) {
  const [messages, setMessages] = useState<StopMessage[]>([])
  const [attachments, setAttachments] = useState<StopAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [sending, setSending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  async function openAttachment(fileUrl: string) {
    // Gesture-safe open (mirrors v1 DailyLogView.openAttachment). Open the window
    // synchronously on the trusted click so iOS doesn't block it as a popup, then
    // fetch the signed R2 URL from inside the app (where we're cookie-authed) and
    // navigate the popup to it. fileUrl already points at the auth-gated media
    // route, so ?json=1 returns the signed URL — fixes the 401 the native app hit
    // when target="_blank" handed the link to the system browser without a cookie.
    const win = window.open('', '_blank')
    const res = await fetch(`${fileUrl}?json=1`)
    if (!res.ok) { win?.close(); return }
    const { url } = await res.json()
    if (win) win.location.href = url
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`/api/hub/daily-log/stops/${stopId}/messages`).then(r => r.json()),
      fetch(`/api/hub/daily-log/stops/${stopId}/attachments`).then(r => r.json()),
    ]).then(([msgData, attData]) => {
      if (cancelled) return
      setMessages(msgData.messages ?? [])
      setAttachments(attData.attachments ?? [])
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [stopId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, attachments])

  // Revoke blob URLs when they leave the staging area
  useEffect(() => {
    return () => {
      pendingFiles.forEach(p => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl) })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stageFiles(files: FileList | File[]) {
    const toAdd: PendingFile[] = Array.from(files).map(file => ({
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    }))
    setPendingFiles(prev => [...prev, ...toAdd])
  }

  function removePending(idx: number) {
    setPendingFiles(prev => {
      const p = prev[idx]
      if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
      return prev.filter((_, i) => i !== idx)
    })
  }

  async function send() {
    const hasText = text.trim().length > 0
    const hasFiles = pendingFiles.length > 0
    if (!hasText && !hasFiles) return
    setSending(true)
    try {
      // Upload files first, sequentially
      for (const pf of pendingFiles) {
        const fd = new FormData()
        fd.append('file', pf.file)
        const res = await fetch(`/api/hub/daily-log/stops/${stopId}/attachments`, { method: 'POST', body: fd })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.attachment) {
          setAttachments(prev => [...prev, data.attachment as StopAttachment])
        }
        if (pf.previewUrl) URL.revokeObjectURL(pf.previewUrl)
      }
      setPendingFiles([])

      // Then post text if present
      if (hasText) {
        const res = await fetch(`/api/hub/daily-log/stops/${stopId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text.trim() }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.message) {
          setMessages(prev => [...prev, data.message as StopMessage])
        }
        setText('')
      }
    } finally {
      setSending(false)
    }
  }

  const threadItems = useMemo<ThreadItem[]>(() => {
    const items: ThreadItem[] = [
      ...messages.map(m => ({ kind: 'message' as const, id: m.id, content: m.content, created_at: m.created_at, user: m.user })),
      ...attachments.map(a => ({ kind: 'file' as const, id: a.id, file_name: a.file_name, file_type: a.file_type, file_size: a.file_size, file_url: a.file_url, created_at: a.created_at, uploaded_by: a.uploaded_by })),
    ]
    return items.sort((a, b) => a.created_at.localeCompare(b.created_at))
  }, [messages, attachments])

  const isImage = (type: string | null) => !!type && /^image\//.test(type)
  const isVideo = (type: string | null) => !!type && /^video\//.test(type)

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-2">Notes &amp; attachments</div>

      {loading ? (
        <div className="text-xs text-gray-500 mb-2">Loading…</div>
      ) : (
        <div className="space-y-2 mb-2 max-h-64 overflow-y-auto">
          {threadItems.length === 0 && (
            <div className="text-xs text-gray-500">No notes or attachments yet.</div>
          )}
          {threadItems.map(item => {
            if (item.kind === 'message') {
              const isMine = item.user?.id === currentUserId
              const initials = item.user ? item.user.display_name.split(/\s+/).map(n => n[0]).join('').slice(0, 2).toUpperCase() : '?'
              return (
                <div key={`m-${item.id}`} className={`flex gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
                  <div className="flex-none w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-[10px] text-gray-300 font-semibold">
                    {initials}
                  </div>
                  <div className={`max-w-[78%] rounded px-2.5 py-1.5 text-xs ${isMine ? 'bg-sky-600/25 text-sky-100' : 'bg-gray-800 text-gray-200'}`}>
                    <div className="font-medium text-[10px] opacity-60 mb-0.5">
                      {item.user?.display_name ?? 'Unknown'} · {formatTime(item.created_at)}
                    </div>
                    <div className="whitespace-pre-wrap">{item.content}</div>
                  </div>
                </div>
              )
            } else {
              const isMine = item.uploaded_by === currentUserId
              return (
                <div key={`f-${item.id}`} className={`flex gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
                  <div className="flex-none w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-[10px] text-gray-300 font-semibold">
                    {isMine ? 'Me' : '?'}
                  </div>
                  <button
                    type="button"
                    onClick={() => openAttachment(item.file_url)}
                    className="max-w-[60%] block text-left bg-gray-800 border border-gray-700 rounded overflow-hidden hover:border-sky-600 transition-colors"
                  >
                    {isImage(item.file_type) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.file_url} alt={item.file_name} className="w-full h-24 object-cover" />
                    ) : (
                      <div className="w-full h-16 flex items-center justify-center text-2xl select-none">
                        {isVideo(item.file_type) ? '🎥' : '📄'}
                      </div>
                    )}
                    <div className="px-2 py-1 text-[10px] text-gray-400 truncate">{item.file_name}</div>
                  </button>
                </div>
              )
            }
          })}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Staged files preview */}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {pendingFiles.map((pf, idx) => (
            <div key={idx} className="relative w-16 h-16 bg-gray-800 rounded border border-gray-700 overflow-hidden flex-none">
              {pf.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pf.previewUrl} alt={pf.file.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xl">📄</div>
              )}
              <button
                onClick={() => removePending(idx)}
                className="absolute top-0.5 right-0.5 w-4 h-4 bg-gray-900/80 rounded-full text-gray-300 hover:text-white flex items-center justify-center text-[10px] leading-none"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="flex gap-2 items-end">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex-none px-2.5 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded transition-colors text-sm"
          title="Attach photo or file"
        >
          📎
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf,video/mp4,video/quicktime"
          multiple
          className="hidden"
          onChange={e => {
            if (e.target.files?.length) stageFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
          }}
          placeholder="Add a note… (Enter to send)"
          rows={2}
          className="flex-1 bg-gray-900 border border-gray-700 rounded px-2.5 py-2 text-base md:text-sm text-white placeholder-gray-500 outline-none focus:border-sky-500 resize-none"
        />
        <button
          onClick={send}
          disabled={sending || (!text.trim() && pendingFiles.length === 0)}
          className="flex-none px-3 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded text-sm font-medium transition-colors self-end"
        >
          {sending ? '…' : '↑'}
        </button>
      </div>
    </div>
  )
}

// ── ServiceReportSection ──────────────────────────────────────────────────────

function ServiceReportSection({
  stopId,
  clientPhone,
}: {
  stopId: string
  clientPhone: string | null
}) {
  const [report, setReport] = useState<ServiceReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [mainService, setMainService] = useState('')
  const [additionalServices, setAdditionalServices] = useState<string[]>([])
  const [issues, setIssues] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    fetch(`/api/hub/daily-log/stops/${stopId}/report`)
      .then(r => r.json())
      .then(d => {
        setLoading(false)
        if (d.report) {
          const r = d.report as ServiceReport
          setReport(r)
          setMainService(r.main_service ?? '')
          setAdditionalServices(r.additional_services ?? [])
          setIssues(r.issues_found ?? [])
          setNotes(r.notes ?? '')
        }
      })
      .catch(() => setLoading(false))
  }, [stopId])

  async function saveReport() {
    setSaving(true)
    try {
      const payload = {
        main_service: mainService || null,
        additional_services: additionalServices,
        issues_found: issues,
        notes: notes || null,
      }
      const method = report ? 'PATCH' : 'POST'
      const res = await fetch(`/api/hub/daily-log/stops/${stopId}/report`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.report) setReport(data.report as ServiceReport)
    } finally {
      setSaving(false)
    }
  }

  async function sendReport() {
    if (!clientPhone) return
    setSending(true)
    setSendResult(null)
    try {
      const res = await fetch(`/api/hub/daily-log/stops/${stopId}/report/send`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setSendResult({ ok: true, msg: 'Report sent to customer' })
        if (data.report) setReport(data.report as ServiceReport)
      } else {
        setSendResult({ ok: false, msg: data.error ?? 'Send failed' })
      }
    } finally {
      setSending(false)
    }
  }

  function toggleAdditional(s: string) {
    setAdditionalServices(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  function toggleIssue(s: string) {
    setIssues(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  if (loading) return null

  const statusLabel = report?.sent_at ? '✓ Sent' : report ? '✓ Saved' : 'Not started'

  return (
    <div className="bg-sky-500/5 border border-sky-700/30 rounded overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-3 py-2.5 flex items-center justify-between text-sm text-sky-200 hover:bg-sky-500/5 transition-colors"
      >
        <span>📋 After-service report</span>
        <span className="text-xs text-sky-300/70">
          {statusLabel} {open ? '▴' : '▾'}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-sky-700/20">
          {/* Main service */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5 mt-2.5">Main service</div>
            <div className="flex flex-wrap gap-1.5">
              {MAIN_SERVICE_OPTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => setMainService(prev => prev === s ? '' : s)}
                  className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                    mainService === s
                      ? 'bg-sky-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Additional services */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Additional services</div>
            <div className="flex flex-wrap gap-1.5">
              {ADDITIONAL_SERVICE_OPTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => toggleAdditional(s)}
                  className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                    additionalServices.includes(s)
                      ? 'bg-emerald-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Issues found */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Issues found</div>
            <div className="flex flex-wrap gap-1.5">
              {ISSUE_OPTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => toggleIssue(s)}
                  className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                    issues.includes(s)
                      ? 'bg-amber-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Notes</div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any additional notes for this visit…"
              rows={2}
              className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-2 text-base md:text-sm text-white placeholder-gray-500 outline-none focus:border-sky-500 resize-y"
            />
          </div>

          {/* Send result */}
          {sendResult && (
            <div className={`text-xs ${sendResult.ok ? 'text-emerald-300' : 'text-red-300'}`}>
              {sendResult.ok ? '✓ ' : '⚠ '}{sendResult.msg}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={saveReport}
              disabled={saving}
              className="flex-1 px-3 py-2.5 bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white rounded text-sm font-medium transition-colors"
            >
              {saving ? 'Saving…' : 'Save report'}
            </button>
            {clientPhone && (
              <button
                onClick={sendReport}
                disabled={sending || !report}
                title={!report ? 'Save the report first' : ''}
                className="flex-1 px-3 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded text-sm font-medium transition-colors"
              >
                {sending ? 'Sending…' : '📱 Send to customer'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
