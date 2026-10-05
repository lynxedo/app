'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import RoutePreviewMap, { type RoutePreviewPin } from '@/components/RoutePreviewMap'
import MediaLightbox, { type LightboxItem } from './MediaLightbox'
import WorkOrderLineItems from './WorkOrderLineItems'
import StopInspection from './StopInspection'
import StopServiceReport from './StopServiceReport'
import { Spinner, EmptyState } from '@/components/ui'
import { fmtQty, type StoredRouteLoadout, type StoredLoadoutProduct } from '@/lib/route-capacity'
import { formatPhone, formatDurationMs, formatDurationSec } from '@/lib/format'
import { keepAwake } from '@/lib/native-device'
import { getDailyLog, saveDailyLog } from '@/lib/hub-cache'
import { isNativeApp } from '@/lib/hub-idle'
import { useOutsideClose } from '@/hooks/use-outside-close'

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

// Work Orders Phase 1 — the irrigation inspection done on this stop (matched on
// the Jobber visit id by the API). `share_url` is set only for a saved report
// whose customer link is still live.
type StopInspection = { id: string; status: 'draft' | 'final'; share_url: string | null }
// Work Orders Phase 3 — the after-service report for this stop's visit (WF / MO).
type StopReport = { id: string; status: 'draft' | 'final'; sent_at: string | null }

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
  // Work Orders Phase 1 — links to the customer file + Jobber, and the
  // inspection for this visit. Null on stops the directory couldn't match.
  contact_id: string | null
  jobber_client_id: string | null
  jobber_job_id: string | null
  inspection: StopInspection | null
  service_report: StopReport | null
  // Work Orders Phase 1.5 — where the stop came from and whether Jobber still has it
  source: 'route' | 'jobber' | null
  jobber_synced_at: string | null
  removed_from_jobber_at: string | null
  // Transient client-side state — not stored on server
  _jobber_warning?: string | null
  _omw_error?: string | null
}

type SkipReason = { id: string; label: string; sort_order: number }

type StopReaction = { user_id: string; emoji: string }

type StopMessage = {
  id: string
  content: string
  created_at: string
  user: { id: string; display_name: string; avatar_url?: string | null } | null
  reactions?: StopReaction[] | null
  /** Set when the note was changed after it was posted — shows "(edited)". */
  edited_at?: string | null
}

/** Ben, Oct 2 2026: a reaction picker on a work order's notes. Same quick set as Daily Log v1. */
const STOP_REACTION_CHOICES = ['👍', '✅', '👀', '❤️', '😂', '🙏', '🔥', '❗']

type StopAttachment = {
  id: string
  file_name: string
  file_type: string | null
  file_size: number | null
  file_url: string
  created_at: string
  uploaded_by: string | null
}

type Entry = {
  id: string
  log_date: string
  created_by: string | null
  office_notes: string | null
  route_sheet_url: string | null
  route_sheet_name: string | null
  completed_at: string | null
  closed_at: string | null
  tech: HubUser | null
  stops: Stop[]
  secondary_techs: HubUser[]
  route_loadout: StoredRouteLoadout | null
  /** Set once the Jobber feed manages this day (Work Orders Phase 1.5). */
  synced_from_jobber_at: string | null
}

type ApiResponse = {
  entries: Entry[]
  depot: { lat: number; lng: number } | null
}

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

/** "Fri, Oct 2" — the phone header's date label. */
function formatShortDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** "Mon 10/5" — the narrowest readable form, for a phone header. */
function formatTinyDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const wd = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short' })
  return `${wd} ${m}/${d}`
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

function formatDuration(ms: number): string {
  return formatDurationMs(ms, { style: 'verbose', seconds: true })
}

// ── UserAvatar ────────────────────────────────────────────────────────────────

function UserAvatar({ user, size = 8 }: { user: HubUser | null; size?: number }) {
  if (!user) return null
  const initials = user.display_name.split(/\s+/).map(n => n[0]).join('').slice(0, 2).toUpperCase()
  const px = size * 4
  return (
    <div
      style={{ width: px, height: px }}
      className="rounded-full bg-brand flex items-center justify-center text-[#fff] font-semibold text-xs flex-none"
    >
      {initials}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DailyLogV2View({
  currentUserId,
  isAdmin,
  canAccessIrrigation = false,
  canCall = false,
  canText = false,
}: {
  currentUserId: string
  isAdmin: boolean
  /** May start / continue an irrigation inspection from a stop (can_access_irrigation or admin). */
  canAccessIrrigation?: boolean
  /** The stop's 📞 Call button — Dialer access (can_access_dialer or admin). */
  canCall?: boolean
  /** The stop's 💬 Text button — Txt access (can_access_txt or admin). */
  canText?: boolean
}) {
  const [date, setDate] = useState<string>(todayStr())
  // Ben, Oct 2 2026: a tech picker replaces All / My Day. null = every tech;
  // otherwise the ids picked (multi-select). Techs land on their own day,
  // admins on everyone — then the phone remembers the last choice.
  const [techSel, setTechSel] = useState<string[] | null>(isAdmin ? null : [currentUserId])
  const [entries, setEntries] = useState<Entry[]>([])
  const [depot, setDepot] = useState<{ lat: number; lng: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  // The stop open in the full-screen view (Ben, Oct 2 2026 — replaces the
  // expand-in-place panel, which pushed everything else off the phone).
  const [openStopId, setOpenStopId] = useState<string | null>(null)
  const [pendingActionStopId, setPendingActionStopId] = useState<string | null>(null)
  const [skipReasons, setSkipReasons] = useState<SkipReason[]>([])
  const [routeCompleteEntryId, setRouteCompleteEntryId] = useState<string | null>(null)
  /** When the copy on screen was saved, or null when it came from the server just now. */
  const [savedAt, setSavedAt] = useState<number | null>(null)
  // Admin: pull this day from the Jobber schedule right now instead of waiting
  // for the sweep (Work Orders Phase 1.5).
  const [syncing, setSyncing] = useState(false)
  const [syncNote, setSyncNote] = useState<string | null>(null)

  // The route sheet is the screen a crew keeps open in the truck all morning.
  // Letting the phone sleep on it means unlocking to read the next stop, so hold
  // it on for as long as this screen is up. No-op off a phone.
  useEffect(() => keepAwake(), [])

  // The tech picker's last choice, per phone. Read after mount (never during
  // render) so the server and client agree on the first paint.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TECH_SEL_KEY)
      if (raw === 'all') setTechSel(null)
      else if (raw) {
        const ids = JSON.parse(raw)
        if (Array.isArray(ids) && ids.length > 0 && ids.every(x => typeof x === 'string')) setTechSel(ids)
      }
    } catch { /* storage blocked — keep the default */ }
  }, [])
  const chooseTechs = useCallback((next: string[] | null) => {
    setTechSel(next)
    try { localStorage.setItem(TECH_SEL_KEY, next ? JSON.stringify(next) : 'all') } catch { /* best effort */ }
  }, [])

  // Deep links — /hub/daily-log-v2?date=YYYY-MM-DD&stop=<id> — from an
  // inspection's "From work order" line or the customer file's Work orders
  // card: land on that day with that stop open. Read once on mount so the
  // date picker stays in charge afterwards.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const d = q.get('date')
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDate(d)
    const stopId = q.get('stop')
    if (stopId) setOpenStopId(stopId)
  }, [])

  // The open stop lives in the URL (?stop=) and in its own history entry, so the
  // phone's Back closes the stop instead of leaving Work Orders — and coming
  // back from the customer file lands on the same stop.
  useEffect(() => {
    const onPop = () => setOpenStopId(new URLSearchParams(window.location.search).get('stop'))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  // Tapping 💧 / 📋 on a row opens the stop AND its inspection / report on top of it.
  const [autoInspectStopId, setAutoInspectStopId] = useState<string | null>(null)
  const [autoReportStopId, setAutoReportStopId] = useState<string | null>(null)
  const openStop = useCallback((stopId: string, opts?: { inspect?: boolean; report?: boolean }) => {
    setAutoInspectStopId(opts?.inspect ? stopId : null)
    setAutoReportStopId(opts?.report ? stopId : null)
    setOpenStopId(stopId)
    const url = new URL(window.location.href)
    url.searchParams.set('date', date)
    url.searchParams.set('stop', stopId)
    window.history.pushState({ ...(window.history.state ?? {}), woStop: stopId }, '', url.toString())
  }, [date])
  const closeStop = useCallback(() => {
    if (window.history.state?.woStop) { window.history.back(); return }
    // Opened from a deep link — there is no entry of ours to pop.
    setOpenStopId(null)
    const url = new URL(window.location.href)
    url.searchParams.delete('stop')
    window.history.replaceState(window.history.state, '', url.toString())
  }, [])

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

    // Paint the saved copy first so the sheet is on screen immediately, then
    // correct it from the server. A crew opening this in a yard behind a house
    // used to get a bare error and no route at all.
    const cached = await getDailyLog<ApiResponse>(d)
    if (cached) {
      setEntries(cached.data.entries ?? [])
      setDepot(cached.data.depot ?? null)
      setSavedAt(cached.savedAt)
      setLoading(false)
    }

    try {
      const res = await fetch(`/api/hub/daily-log-v2?date=${d}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Failed (${res.status})`)
      }
      const data = (await res.json()) as ApiResponse
      setEntries(data.entries ?? [])
      setDepot(data.depot ?? null)
      setSavedAt(null)               // this is live now
      void saveDailyLog(d, data)
    } catch (e) {
      // ⚠ With a saved copy in hand this is NOT an error state — it is a stale
      // one, and the banner says so. Blanking the screen would take away the
      // route they still need to drive.
      if (!cached) {
        // ⚠⚠ But with NOTHING saved for this day, the stops still on screen
        // belong to the day we just moved away from. Leaving them under the new
        // date is the exact trap this whole feature exists to avoid: a route
        // sheet that looks current and is not. Clear it.
        setEntries([])
        setDepot(null)
        setSavedAt(null)
        setError(
          e instanceof TypeError
            ? "No connection — this day hasn't been opened on this phone yet."
            : e instanceof Error ? e.message : 'Failed to load',
        )
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(date)
  }, [date, load])

  async function syncFromJobber() {
    if (syncing) return
    setSyncing(true); setSyncNote(null)
    try {
      const res = await fetch('/api/hub/work-orders/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setSyncNote(j.error || `Sync failed (${res.status})`); return }
      const r = (j.results ?? [])[0] ?? {}
      const bits = [
        `${r.visits ?? 0} visit${r.visits === 1 ? '' : 's'} in Jobber`,
        `${r.techs ?? 0} tech${r.techs === 1 ? '' : 's'}`,
        r.inserted ? `${r.inserted} added` : null,
        r.moved ? `${r.moved} moved` : null,
        r.deleted ? `${r.deleted} removed` : null,
        r.flagged ? `${r.flagged} flagged` : null,
        r.ghostsRemoved ? `${r.ghostsRemoved} stale visit${r.ghostsRemoved === 1 ? '' : 's'} cleared (Jobber no longer has them)` : null,
        r.refreshed ? `${r.refreshed} re-pulled from Jobber` : null,
        r.daysFolded ? `${r.daysFolded} empty day${r.daysFolded === 1 ? '' : 's'} folded` : null,
        r.unmappedTechs?.length ? `not linked to a Hub person: ${r.unmappedTechs.join(', ')}` : null,
        r.noCreator ? 'Jobber is not connected — new days could not be created' : null,
        r.liveChecked === false ? `⚠ could not check Jobber live (${r.liveError || 'unknown'}) — used the mirror as-is` : null,
      ].filter(Boolean)
      setSyncNote(`Synced · ${bits.join(' · ')}`)
      await load(date)
    } catch (e) {
      setSyncNote(e instanceof Error ? e.message : 'Sync failed')
    } finally { setSyncing(false) }
  }

  const visibleEntries = useMemo(() => {
    if (!techSel) return entries
    const want = new Set(techSel)
    return entries.filter(e =>
      (e.tech && want.has(e.tech.id)) ||
      e.secondary_techs.some(t => want.has(t.id)),
    )
  }, [entries, techSel])

  // Everyone with a day on screen, for the picker (plus "Me", always offered).
  const techOptions = useMemo(() => {
    const m = new Map<string, HubUser>()
    for (const e of entries) {
      if (e.tech) m.set(e.tech.id, e.tech)
      for (const t of e.secondary_techs) m.set(t.id, t)
    }
    return [...m.values()].sort((a, b) => a.display_name.localeCompare(b.display_name))
  }, [entries])

  // The open stop, looked up fresh each render so every action's patch shows.
  const openStopCtx = useMemo(() => {
    if (!openStopId) return null
    for (const e of entries) {
      const st = e.stops.find(x => x.id === openStopId)
      if (st) return { stop: st, entry: e }
    }
    return null
  }, [entries, openStopId])

  const isToday = date === todayStr()

  return (
    <div className="flex flex-col h-full">
      {/* Ben, Oct 2 2026: the header was three rows on a phone. Now ONE row:
          ‹ date › · Today (only off today) · tech picker · ↻ — tap the date to
          pick a day. The title shows from tablet width up. */}
      <header className="flex-none px-3 md:px-6 py-1.5 md:pt-4 md:pb-3 border-b border-gray-800 max-md:pl-14">
        <div className="max-w-5xl mx-auto">
          <div className="hidden md:flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-semibold text-white truncate">Work Orders</h1>
            <span className="text-xs bg-white/10 text-gray-300 px-2 py-0.5 rounded" title="The office name for this screen">Daily Log v2</span>
            <span className="ml-auto text-xs text-gray-400">{formatDateHeading(date)}</span>
          </div>
          <p className="text-sm text-gray-400 hidden md:block">
            Your stops for the day, in route order — each one is a work order. The day fills itself from the Jobber schedule; the office changes it in Jobber or with the Route Optimizer.
          </p>
          <div className="flex flex-wrap items-center gap-1 md:gap-1.5 md:mt-3 min-w-0">
            <button
              onClick={() => setDate(offsetDate(date, -1))}
              aria-label="Previous day"
              className="flex-none w-7 md:w-8 h-8 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm text-white"
            >‹</button>
            {/* The label is what you see; the real date input sits on top of it,
                invisible, so a tap opens the phone's own date picker. */}
            <label className="relative flex-none h-8 px-1.5 md:px-2 flex items-center bg-gray-800 border border-gray-700 rounded text-sm text-white whitespace-nowrap cursor-pointer">
              <span className="md:hidden">{formatTinyDate(date)}</span>
              <span className="hidden md:inline">{formatShortDate(date)}</span>
              <input
                type="date"
                value={date}
                onChange={e => { if (e.target.value) setDate(e.target.value) }}
                aria-label="Pick a day"
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
            </label>
            <button
              onClick={() => setDate(offsetDate(date, 1))}
              aria-label="Next day"
              className="flex-none w-7 md:w-8 h-8 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm text-white"
            >›</button>
            {!isToday && (
              <button
                onClick={() => setDate(todayStr())}
                className="flex-none h-8 px-1.5 md:px-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-xs text-sky-200"
              >Today</button>
            )}
            <TechPicker
              options={techOptions}
              selected={techSel}
              currentUserId={currentUserId}
              onChange={chooseTechs}
              onSync={isAdmin ? syncFromJobber : undefined}
              syncing={syncing || loading}
              showOffice={isAdmin}
            />
            {isAdmin && (
              <button
                onClick={syncFromJobber}
                disabled={syncing || loading}
                title="Rebuild this day's Work Orders from the Jobber schedule now (it also happens on its own every few minutes)"
                aria-label="Sync from Jobber"
                className="hidden md:inline-flex items-center flex-none h-8 px-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm text-sky-200 disabled:opacity-50"
              >
                {syncing ? 'Syncing…' : '↻ Sync from Jobber'}
              </button>
            )}
          </div>
          {syncNote && <div className="text-xs text-sky-300 mt-1">{syncNote}</div>}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-5xl mx-auto px-3 md:px-6 py-3 md:py-4 pb-24">
          {loading && <div className="py-12 text-center"><Spinner size={6} /></div>}
          {error && (
            <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm mb-4">
              {error}
            </div>
          )}
          {/* ⚠ A cached route sheet must never pass for a live one. The stops
              carry state that only the server has, and marking one complete from
              here would go nowhere, so say plainly what this is and how old. */}
          {savedAt !== null && (
            <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-lg px-4 py-3 text-sm mb-4">
              <strong className="text-amber-200">Saved copy</strong> from{' '}
              {new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              {' '}&mdash; no connection right now. You can read the route, but
              anything you tap won&apos;t save until you&apos;re back in signal.
            </div>
          )}
          {!loading && !error && visibleEntries.length === 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 md:p-8 text-center">
              <p className="text-gray-400 mb-2">No work orders for {formatDateHeading(date)}{techSel ? ' for the tech(s) picked' : ''}.</p>
              <p className="text-sm text-gray-500">
                A tech&apos;s day appears here on its own from the Jobber schedule once visits are assigned to them for this date.
                {isAdmin ? ' Use ↻ Sync from Jobber (in the 👤 menu on a phone) to pull it now, or send a route from the ' : ' The office can also send a route from the '}
                <a href="/hub/routing" className="text-sky-400 hover:underline">Route Optimizer</a>.
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
                openStopId={openStopId}
                showRouteCompleteBanner={routeCompleteEntryId === entry.id}
                onOpenStop={openStop}
                onMarkRouteComplete={handleMarkRouteComplete}
                onDismissRouteComplete={() => setRouteCompleteEntryId(null)}
              />
            ))}
          </div>
        </div>
      </div>

      {openStopCtx && (
        <StopSheet
          key={openStopCtx.stop.id}
          stop={openStopCtx.stop}
          pending={pendingActionStopId === openStopCtx.stop.id}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          canAccessIrrigation={canAccessIrrigation}
          canCall={canCall}
          canText={canText}
          skipReasons={skipReasons}
          onClose={closeStop}
          onArrive={handleArrive}
          onComplete={(stopId, undo) => handleComplete(stopId, undo, openStopCtx.entry.id)}
          onSkip={handleSkip}
          onOnMyWay={handleOnMyWay}
          onPestNotesSave={handlePestNotesSave}
          date={openStopCtx.entry.log_date}
          autoInspect={autoInspectStopId === openStopCtx.stop.id}
          onAutoInspectDone={() => setAutoInspectStopId(null)}
          autoReport={autoReportStopId === openStopCtx.stop.id}
          onAutoReportDone={() => setAutoReportStopId(null)}
          onRefresh={() => { void load(date) }}
        />
      )}
    </div>
  )
}

// ── Tech picker ───────────────────────────────────────────────────────────────

const TECH_SEL_KEY = 'lynxedo.workOrders.techs'

/**
 * Ben, Oct 2 2026: "Instead of All/My Day I would like a drop-down box to choose
 * which tech to look at. You can multiselect or there can be an ALL option."
 * `selected` null = all techs.
 */
function TechPicker({ options, selected, currentUserId, onChange, onSync, syncing, showOffice }: {
  options: HubUser[]
  selected: string[] | null
  currentUserId: string
  onChange: (next: string[] | null) => void
  /** Admins: "↻ Sync this day from Jobber" lives in this menu on a phone (no room in the row). */
  onSync?: () => void
  syncing?: boolean
  /** Admins: the Work Orders office lists (Phase 2 — needs attention, changed, ready to invoice). */
  showOffice?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutsideClose(ref, open, () => setOpen(false))

  const isMeOnly = !!selected && selected.length === 1 && selected[0] === currentUserId
  const label = !selected
    ? 'All techs'
    : isMeOnly
      ? 'Me'
      : selected.length === 1
        ? (options.find(o => o.id === selected[0])?.display_name.split(/\s+/)[0] ?? '1 tech')
        : `${selected.length} techs`

  function toggle(id: string) {
    const cur = selected ?? []
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
    onChange(next.length ? next : null)
  }

  const row = 'w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-gray-700'
  const box = (on: boolean) => (
    <span className={`flex-none w-4 h-4 rounded border flex items-center justify-center text-[10px] ${on ? 'bg-sky-500 border-sky-500 text-[#fff]' : 'border-gray-500'}`}>
      {on ? '✓' : ''}
    </span>
  )

  return (
    <div ref={ref} className="relative flex flex-1 basis-[3.25rem] min-w-[3.25rem] justify-end">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="h-8 px-1.5 md:px-2 max-w-full md:max-w-[12rem] min-w-0 flex items-center gap-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm text-white"
        title="Choose which techs to show"
      >
        <span className="flex-none" aria-hidden>👤</span>
        <span className="truncate min-w-0">{label}</span>
        <span className="flex-none text-gray-400 text-xs" aria-hidden>▾</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 z-30 w-60 max-h-80 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-2xl py-1">
          <button type="button" role="menuitemcheckbox" aria-checked={!selected} className={row} onClick={() => { onChange(null); setOpen(false) }}>
            {box(!selected)}<span className="text-white">All techs</span>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={isMeOnly} className={row} onClick={() => { onChange([currentUserId]); setOpen(false) }}>
            {box(isMeOnly)}<span className="text-white">Me</span>
          </button>
          {options.length > 0 && <div className="my-1 border-t border-gray-700" />}
          {options.map(o => {
            const on = !!selected && selected.includes(o.id)
            return (
              <button key={o.id} type="button" role="menuitemcheckbox" aria-checked={on} className={row} onClick={() => toggle(o.id)}>
                {box(on)}
                <span className="text-gray-200 truncate">{o.display_name}{o.id === currentUserId ? ' (me)' : ''}</span>
              </button>
            )
          })}
          {options.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-500">No tech has a day on this date.</div>
          )}
          {onSync && (
            <>
              <div className="my-1 border-t border-gray-700 md:hidden" />
              <button
                type="button"
                role="menuitem"
                disabled={syncing}
                className={`${row} md:hidden text-sky-200 disabled:opacity-50`}
                onClick={() => { setOpen(false); onSync() }}
              >
                <span className="flex-none w-4 text-center" aria-hidden>↻</span>
                <span>{syncing ? 'Syncing…' : 'Sync this day from Jobber'}</span>
              </button>
            </>
          )}
          {showOffice && (
            <>
              <div className="my-1 border-t border-gray-700" />
              <Link href="/hub/daily-log-v2/office" role="menuitem" className={`${row} text-emerald-200`} onClick={() => setOpen(false)}>
                <span className="flex-none w-4 text-center" aria-hidden>🧾</span>
                <span>Office: line items &amp; invoicing</span>
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Route loadout header (Route Capacity Part D) ────────────────────────────────
// Read-only display of the loadout snapshot written when the route was sent from
// the Route Optimizer: predicted times, total sq ft, tank fill, products to mix.
function fmtHrsMin(min: number | null | undefined): string | null {
  if (min == null || min <= 0) return null
  return formatDurationSec(min * 60, { style: 'verbose' })
}

// Group loadout products by line item, so the same product applied for two line
// items shows once per line item (matching the optimizer's tank loadout card).
function groupByLineItem(products: StoredLoadoutProduct[]): [string, StoredLoadoutProduct[]][] {
  const groups = new Map<string, StoredLoadoutProduct[]>()
  for (const p of products) {
    const key = p.line_item || '(unspecified)'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(p)
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

function RouteLoadoutHeader({ loadout }: { loadout: StoredRouteLoadout | null }) {
  const [open, setOpen] = useState(true)
  if (!loadout) return null

  const drive = fmtHrsMin(loadout.predicted_drive_minutes)
  const onsite = fmtHrsMin(loadout.predicted_onsite_minutes)
  const hasProducts = loadout.products.length > 0
  const hasTanks = loadout.tanks.length > 0
  // Nothing useful to show (no times, no products, no tanks) — stay out of the way.
  if (!drive && !onsite && !hasProducts && !hasTanks && loadout.total_sqft === 0) return null

  return (
    <div className="px-5 py-3 bg-sky-500/5 border-b border-gray-800">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-3 text-left">
        <span className="text-xs font-medium text-sky-300 flex items-center gap-2">
          <span>{open ? '▾' : '▸'}</span> 🧪 Route Loadout
        </span>
        <span className="text-[11px] text-gray-400 flex items-center gap-2 flex-wrap justify-end">
          {onsite && <span>⏱ {onsite} on-site</span>}
          {drive && <span>🚗 {drive} drive</span>}
          {loadout.total_sqft > 0 && <span>📐 {loadout.total_sqft.toLocaleString()} sq ft</span>}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {hasTanks && (
            <div className="space-y-2">
              {loadout.tanks.map(t => {
                const pct = t.fill_pct == null ? null : Math.round(t.fill_pct * 100)
                const barPct = t.fill_pct == null ? 0 : Math.min(t.fill_pct, 1) * 100
                return (
                  <div key={t.tank_number}>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-gray-300">{t.label || `Tank ${t.tank_number}`}</span>
                      <span className={t.overflow ? 'text-red-400 font-medium' : 'text-gray-400'}>
                        {pct == null ? '—' : <>{pct}% · {Math.round(t.sqft_loaded).toLocaleString()} / {Math.round(t.sprayable_sqft ?? 0).toLocaleString()} sq ft{t.overflow ? ' · ⚠ refill' : ''}</>}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
                      <div className={`h-full ${t.overflow ? 'bg-red-500' : barPct > 80 ? 'bg-amber-500' : 'bg-green-600'}`} style={{ width: `${barPct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {hasProducts ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-gray-500 text-left border-b border-gray-800">
                    <th className="py-1 pr-2 font-medium">Product</th>
                    <th className="py-1 px-2 font-medium text-right">Amount</th>
                    <th className="py-1 pl-2 font-medium">Tank</th>
                  </tr>
                </thead>
                <tbody>
                  {groupByLineItem(loadout.products).map(([lineItem, lines]) => (
                    <Fragment key={lineItem}>
                      <tr className="bg-gray-800/30">
                        <td colSpan={3} className="py-1 pr-2 text-[10px] font-semibold text-sky-300/90 uppercase tracking-wide">{lineItem}</td>
                      </tr>
                      {lines.map((p, i) => (
                        <tr key={p.service_product_id || `${p.product_id}-${i}`} className="border-b border-gray-800/50">
                          <td className="py-1 pr-2 pl-3 text-white">{p.name}</td>
                          <td className="py-1 px-2 text-right text-gray-300 whitespace-nowrap">{fmtQty(p.quantity)} {p.unit}</td>
                          <td className="py-1 pl-2 text-gray-400">{p.tank ? `Tank ${p.tank}` : '—'}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !loadout.has_mappings ? (
            <p className="text-[11px] text-gray-500">No product mappings configured — product amounts unavailable.</p>
          ) : null}

          {loadout.unmapped_line_items.length > 0 && (
            <p className="text-[11px] text-gray-500">
              <span className="text-amber-400">Unmapped:</span> {loadout.unmapped_line_items.slice(0, 6).join(', ')}
              {loadout.unmapped_line_items.length > 6 ? `, +${loadout.unmapped_line_items.length - 6} more` : ''}
            </p>
          )}
        </div>
      )}
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
  openStopId,
  showRouteCompleteBanner,
  onOpenStop,
  onMarkRouteComplete,
  onDismissRouteComplete,
}: {
  entry: Entry
  depot: { lat: number; lng: number } | null
  isAdmin: boolean
  currentUserId: string
  mapHeight: number
  openStopId: string | null
  showRouteCompleteBanner: boolean
  onOpenStop: (stopId: string, opts?: { inspect?: boolean }) => void
  onMarkRouteComplete: (entryId: string) => void | Promise<void>
  onDismissRouteComplete: () => void
}) {
  const [officeNotesDraft, setOfficeNotesDraft] = useState(entry.office_notes ?? '')
  const [officeNotesSaving, setOfficeNotesSaving] = useState(false)
  // An empty instructions box is a big yellow block on a phone — fold it to a
  // one-line "+ Add" until there is something to say.
  const [officeNotesOpen, setOfficeNotesOpen] = useState(!!entry.office_notes)

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

  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null)

  // Route sheet lives in local state so an upload/replace reflects immediately
  // (the parent re-fetches on the next poll, but this keeps the card in sync now).
  const [routeSheet, setRouteSheet] = useState<{ url: string | null; name: string | null }>({
    url: entry.route_sheet_url,
    name: entry.route_sheet_name,
  })
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const routeSheetInputRef = useRef<HTMLInputElement>(null)
  const canEditRouteSheet = isAdmin || (entry.created_by != null && entry.created_by === currentUserId)

  function openRouteSheet() {
    // Open in the in-app viewer (MediaLightbox) — renders inside the logged-in Hub
    // webview, so it works on every platform including the iOS/Android apps. The old
    // window.open('', '_blank') gesture-popup returns null in the iOS Capacitor
    // webview, so the route sheet never opened there. HTML sheets render in an
    // iframe; PDFs render via pdf.js (canvas).
    if (!routeSheet.url) return
    const isHtml = routeSheet.url.endsWith('.html')
    const base = `/api/hub/daily-log/${entry.id}/route-sheet`
    setLightbox({
      items: [{
        type: isHtml ? 'html' : 'pdf',
        src: isHtml ? base : `${base}?inline=pdf`,
        downloadSrc: base,
        filename: routeSheet.name ?? 'Route Sheet',
      }],
      index: 0,
    })
  }

  async function uploadRouteSheet(file: File) {
    setUploading(true)
    setUploadError('')
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`/api/hub/daily-log/${entry.id}/upload`, { method: 'POST', body: fd })
    const data = await res.json()
    setUploading(false)
    if (res.ok) {
      setRouteSheet({ url: data.route_sheet_url, name: data.route_sheet_name })
    } else {
      setUploadError(data.error ?? 'Upload failed')
    }
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

  // Ben, Oct 2 2026: a finished stop drops to the bottom (greyed) so the next
  // stop is always at the top. Each keeps its route number.
  const isDone = (s: Stop) => s.status === 'complete' || s.status === 'skipped'
  const openStops = entry.stops.filter(s => !isDone(s))
  const doneStops = entry.stops.filter(isDone)

  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden ${isClosed ? 'opacity-60' : ''}`}>
      {/* Header */}
      <div className="px-4 md:px-5 py-3 md:py-4 border-b border-gray-800 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
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
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {entry.synced_from_jobber_at && (
            <span
              className="hidden md:inline text-[10px] text-sky-300/80 bg-sky-500/10 px-2 py-1 rounded"
              title={`Follows the Jobber schedule · last synced ${formatTime(entry.synced_from_jobber_at)}`}
            >
              Jobber-fed
            </span>
          )}
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
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-[#fff] rounded text-sm font-semibold transition-colors"
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
      {isAdmin && !officeNotesOpen ? (
        <button
          type="button"
          onClick={() => setOfficeNotesOpen(true)}
          className="w-full text-left px-4 md:px-5 py-2 border-b border-gray-800 text-xs text-amber-300/80 hover:bg-amber-500/5"
        >
          + Office instructions
        </button>
      ) : isAdmin ? (
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

      {/* Route loadout (Route Capacity Part D) — products, tanks, predicted times */}
      <RouteLoadoutHeader loadout={entry.route_loadout} />

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
          <>
            {openStops.map(s => (
              <StopRow key={s.id} stop={s} date={entry.log_date} active={openStopId === s.id} onOpen={onOpenStop} />
            ))}
            {doneStops.length > 0 && (
              <div className="px-4 md:px-5 py-1.5 bg-gray-950/40 text-[10px] uppercase tracking-wide text-gray-500">
                Done · {doneStops.length}
              </div>
            )}
            {doneStops.map(s => (
              <StopRow key={s.id} stop={s} date={entry.log_date} active={openStopId === s.id} onOpen={onOpenStop} />
            ))}
          </>
        )}
      </div>

      {/* Route Sheet — mirrors Daily Log v1 (clickable card + Upload/Replace PDF) */}
      <div className="px-5 py-3 bg-gray-900/50 border-t border-gray-800">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">Route Sheet</span>
          {canEditRouteSheet && (
            <button
              onClick={() => routeSheetInputRef.current?.click()}
              disabled={uploading}
              className="text-xs text-brand hover:text-blue-300 transition-colors disabled:opacity-40"
            >
              {uploading ? 'Uploading…' : routeSheet.url ? 'Replace' : '+ Upload PDF'}
            </button>
          )}
          <input
            ref={routeSheetInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) uploadRouteSheet(f)
              e.target.value = ''
            }}
          />
        </div>
        {uploadError && <p className="text-xs text-red-400 mb-1">{uploadError}</p>}
        {routeSheet.url ? (
          <button
            type="button"
            onClick={openRouteSheet}
            className="w-full text-left cursor-pointer flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700/80 border border-gray-700 rounded-xl transition-colors group"
          >
            <svg className="w-5 h-5 text-red-400 flex-none" fill="currentColor" viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM12 14h-2v2h2v-2zm0-4h-2v3h2v-3z" />
            </svg>
            <span className="text-sm text-gray-300 group-hover:text-white truncate flex-1">
              {routeSheet.name ?? 'Route Sheet'}
            </span>
            <svg className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-300 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        ) : (
          <p className="text-sm text-gray-600 italic">No route sheet attached</p>
        )}
      </div>

      {isAdmin && (
        <div className="px-5 py-2 bg-gray-900/30 border-t border-gray-800 text-[10px] text-gray-600 uppercase tracking-wide">
          v2 preview — Phases 1–6 live
        </div>
      )}

      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}

// ── Work order links ──────────────────────────────────────────────────────────

/**
 * Ben, Oct 1 2026: an irrigation stop is an "IR job" — in the Jobber catalog every
 * irrigation item is prefixed "IR - " (service call, service plan, spray head,
 * valve repair, backflow …), so a stop is irrigation when any line item carries
 * that prefix. The Inspection button appears only on these.
 */
function isIrrigationStop(stop: Stop): boolean {
  return stop.line_items.some(li => /^\s*IR\s*-/i.test(li.name ?? ''))
}

/**
 * Where the stop's inspection link goes and what it says: Start (none yet),
 * Continue (a draft), View (a saved report). Null when the stop has no customer
 * file — an inspection needs one. The grant is enforced on the customer page
 * (its Irrigation card only opens the form for people who may edit), so the link
 * itself is shown to everyone on an irrigation stop.
 */
/**
 * The customer file, opened from a stop — carries the way back so the file
 * shows a "‹ Back to stop" bar (Ben, Oct 5 2026: getting back to Work Orders
 * from the customer file was not quick and easy).
 */
function customerFileHref(stop: Stop, date: string): string | null {
  if (!stop.contact_id) return null
  return `/hub/contacts/${stop.contact_id}?woDate=${encodeURIComponent(date)}&woStop=${encodeURIComponent(stop.id)}`
}

function inspectionLink(stop: Stop): { href: string; label: string; state: 'start' | 'draft' | 'final' } | null {
  if (!stop.contact_id) return null
  const insp = stop.inspection
  if (insp?.status === 'final') {
    return { href: `/hub/contacts/${stop.contact_id}?irrigation=open&insp=${encodeURIComponent(insp.id)}`, label: 'View inspection', state: 'final' }
  }
  const href = `/hub/contacts/${stop.contact_id}?irrigation=new&stop=${encodeURIComponent(stop.id)}`
    + (stop.jobber_visit_id ? `&visit=${encodeURIComponent(stop.jobber_visit_id)}` : '')
  return insp?.status === 'draft'
    ? { href, label: 'Continue inspection', state: 'draft' }
    : { href, label: 'Start inspection', state: 'start' }
}

/**
 * Ben, Oct 2 2026: the after-service report (and the pesticide application
 * notes) belong on lawn-treatment stops only — WF (weed & fert) and MO
 * (mosquito) in the Jobber catalog. An irrigation or pet-waste stop never
 * shows them.
 */
function isTreatmentStop(stop: Stop): boolean {
  return stop.line_items.some(li => /^\s*(WF|MO)\s*-/i.test(li.name ?? ''))
}

/** The after-service report's state in a word or two: Fill out / Continue / ✓ Saved / ✓ Sent. */
function reportLabel(stop: Stop): string {
  const r = stop.service_report
  if (!r) return 'Fill out report'
  if (r.status === 'draft') return 'Continue report'
  return r.sent_at ? 'Report ✓ sent' : 'Report ✓'
}

/**
 * One round icon with a small label under it — the stop's action row and its
 * bottom bar. Same round-emoji look as the Txt conversation header.
 */
function ActionIcon({ icon, label, onClick, href, external, disabled, tone = 'gray', title }: {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  href?: string | null
  external?: boolean
  disabled?: boolean
  tone?: 'gray' | 'indigo' | 'cyan' | 'sky' | 'amber' | 'emerald' | 'muted'
  title?: string
}) {
  const tones: Record<string, string> = {
    gray: 'bg-white/10 text-white hover:bg-white/20',
    indigo: 'bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/30',
    cyan: 'bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30',
    sky: 'bg-sky-500/20 text-sky-100 hover:bg-sky-500/30',
    amber: 'bg-amber-500/25 text-amber-100 hover:bg-amber-500/35',
    emerald: 'bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30',
    muted: 'bg-white/5 text-gray-500',
  }
  const circle = `w-11 h-11 rounded-full flex items-center justify-center text-lg transition-colors ${disabled ? tones.muted : tones[tone]}`
  const inner = (
    <>
      <span className={circle} aria-hidden>{icon}</span>
      <span className={`text-[10px] leading-tight text-center max-w-[4.5rem] truncate ${disabled ? 'text-gray-600' : 'text-gray-300'}`}>{label}</span>
    </>
  )
  const wrap = 'flex flex-col items-center gap-1 min-w-0'
  if (href && !disabled) {
    return external
      ? <a href={href} target="_blank" rel="noopener noreferrer" className={wrap} title={title ?? label}>{inner}</a>
      : <Link href={href} className={wrap} title={title ?? label}>{inner}</Link>
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${wrap} disabled:cursor-not-allowed`} title={title ?? label} aria-label={label}>
      {inner}
    </button>
  )
}

// ── StopRow (the compact line in the list) ────────────────────────────────────

function StopRow({ stop, date, active, onOpen }: {
  stop: Stop
  date: string
  active: boolean
  onOpen: (stopId: string, opts?: { inspect?: boolean; report?: boolean }) => void
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

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(stop.id)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(stop.id) } }}
      className={`w-full text-left px-4 md:px-5 py-3 flex items-start gap-3 hover:bg-gray-800/40 transition-colors cursor-pointer select-none ${
        isComplete || isSkipped ? 'opacity-55 bg-gray-950/30' : ''
      } ${active ? 'bg-gray-800/30' : ''}`}
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
        title={`Stop ${stop.ord}`}
      >
        {isComplete ? '✓' : isSkipped ? '⊘' : pinLabel(stop.ord)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`font-medium ${isComplete || isSkipped ? 'text-gray-400' : 'text-white'}`}>
            {stop.client_name}
          </div>
          {stop.contact_id && (
            <Link
              href={customerFileHref(stop, date) ?? `/hub/contacts/${stop.contact_id}`}
              onClick={e => e.stopPropagation()}
              className="text-[11px] text-sky-400 hover:text-sky-300 hover:underline"
              title="Open the customer file"
            >
              Customer file ›
            </Link>
          )}
          {isIrrigationStop(stop) && (() => {
            const link = inspectionLink(stop)
            return link ? (
              <Link
                href={link.href}
                onClick={e => { e.preventDefault(); e.stopPropagation(); onOpen(stop.id, { inspect: true }) }}
                className={`text-[11px] hover:underline ${link.state === 'final' ? 'text-cyan-300' : 'text-cyan-400'}`}
                title="Irrigation inspection for this visit"
              >
                💧 {link.label} ›
              </Link>
            ) : null
          })()}
          {isTreatmentStop(stop) && !isSkipped && stop.contact_id && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onOpen(stop.id, { report: true }) }}
              className={`text-[11px] hover:underline ${stop.service_report?.status === 'final' ? 'text-emerald-300' : 'text-emerald-400'}`}
              title="After-service report for this visit"
            >
              📋 {reportLabel(stop)} ›
            </button>
          )}
          {isComplete && stop.completed_at && (
            <div className="text-[10px] bg-emerald-500/15 text-emerald-300 px-1.5 py-0.5 rounded">
              ✓ Done {formatTime(stop.completed_at)}
            </div>
          )}
          {stop.scheduled_start_at && !isComplete && !isSkipped && (
            <div className="text-xs text-gray-400">{formatTime(stop.scheduled_start_at)}</div>
          )}
          {stop.duration_minutes && !isComplete && !isSkipped && (
            <div className="text-xs text-gray-500">~{stop.duration_minutes} min</div>
          )}
          {isInProgress && (
            <div className="text-[10px] bg-amber-500/20 text-amber-200 px-1.5 py-0.5 rounded">On site</div>
          )}
          {stop.on_my_way_sent_at && !isComplete && !isSkipped && (
            <div className="text-[10px] bg-sky-500/15 text-sky-300 px-1.5 py-0.5 rounded">
              🚗 {formatTime(stop.on_my_way_sent_at)}
            </div>
          )}
          {isSkipped && (
            <div className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">
              {stop.skip_reason_label ?? 'Skipped'}
            </div>
          )}
          {stop.removed_from_jobber_at && (
            <div className="text-[10px] bg-red-500/15 text-red-300 px-1.5 py-0.5 rounded" title="This visit is no longer on your day in Jobber (moved, reassigned or deleted). Kept because you had already started on it.">
              ⚠ Removed from Jobber
            </div>
          )}
        </div>
        <div className="text-sm text-gray-400 truncate">{stop.address}</div>
        {stop.job_title && (
          <div className="text-xs text-gray-500 mt-0.5">{stop.job_title}</div>
        )}
        {lineItemsSummary && (
          <div className="text-xs text-gray-500 mt-0.5">{lineItemsSummary}</div>
        )}
      </div>
      <div className="flex-none self-center text-gray-500 text-lg" aria-hidden>›</div>
    </div>
  )
}

// ── StopSheet (one stop, full screen) ─────────────────────────────────────────

/**
 * Ben, Oct 2 2026: "Instead of expanding maybe it pops up a new screen. That way
 * everything about that stop is more visible on the display." On a phone it
 * covers the page above the app's bottom bar; on a desktop it is a panel on the
 * right. The phone's Back closes it (the parent owns the history entry).
 *
 * Top: one row of round icons — customer file, inspection (irrigation stops),
 * navigate, on my way, call, text. Bottom: the stop's actions as a bar of
 * icons — arrived, complete, skip (or reopen / undo skip).
 */
function StopSheet({
  stop,
  pending,
  currentUserId,
  isAdmin,
  canAccessIrrigation,
  canCall,
  canText,
  skipReasons,
  onClose,
  onArrive,
  onComplete,
  onSkip,
  onOnMyWay,
  onPestNotesSave,
  date,
  autoInspect,
  onAutoInspectDone,
  autoReport,
  onAutoReportDone,
  onRefresh,
}: {
  stop: Stop
  pending: boolean
  currentUserId: string
  isAdmin: boolean
  canAccessIrrigation: boolean
  canCall: boolean
  canText: boolean
  skipReasons: SkipReason[]
  onClose: () => void
  onArrive: (stopId: string, undo: boolean) => void | Promise<void>
  onComplete: (stopId: string, undo: boolean) => void | Promise<void>
  onSkip: (stopId: string, undo: boolean, reasonId?: string, reasonLabel?: string) => void | Promise<void>
  onOnMyWay: (stopId: string, etaMinutes: number) => Promise<{ ok: true } | { ok: false }>
  onPestNotesSave: (stopId: string, notes: string) => Promise<{ ok: true } | { ok: false; error: string }>
  date: string
  autoInspect?: boolean
  onAutoInspectDone?: () => void
  autoReport?: boolean
  onAutoReportDone?: () => void
  onRefresh?: () => void
}) {
  const router = useRouter()
  const isComplete = stop.status === 'complete'
  const isInProgress = stop.status === 'in_progress'
  const isSkipped = stop.status === 'skipped'
  const isIrrigation = isIrrigationStop(stop)
  const isTreatment = isTreatmentStop(stop)

  const [omwPickerOpen, setOmwPickerOpen] = useState(false)
  const [omwEta, setOmwEta] = useState<number>(15)
  const [omwCustom, setOmwCustom] = useState<string>('')

  const [skipPickerOpen, setSkipPickerOpen] = useState(false)
  const [selectedReasonId, setSelectedReasonId] = useState<string | null>(null)
  const [selectedReasonLabel, setSelectedReasonLabel] = useState<string | null>(null)

  const [texting, setTexting] = useState(false)
  const [textError, setTextError] = useState<string | null>(null)

  // Pesticide tech notes local state
  const [pestNotesDraft, setPestNotesDraft] = useState(stop.pesticide_tech_notes ?? '')
  const [pestNotesStatus, setPestNotesStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [pestNotesError, setPestNotesError] = useState<string | null>(null)

  useEffect(() => {
    setPestNotesDraft(prev => (pestNotesStatus === 'idle' ? (stop.pesticide_tech_notes ?? '') : prev))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop.pesticide_tech_notes])

  // Esc closes on a desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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

  // Live timer — ticks while the stop is open and in progress
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isInProgress || !stop.arrived_at) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [isInProgress, stop.arrived_at])

  const navHref = stop.address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}`
    : null
  const inspLink = isIrrigation ? inspectionLink(stop) : null
  const customerHref = customerFileHref(stop, date)

  // The inspection opens on top of the stop (Work Orders never goes away).
  // Starting/continuing needs the Irrigation grant; a saved report anyone views.
  // Without the grant, an unsaved one still goes to the customer file (read-only there).
  const inspMode: 'edit' | 'view' | null = !inspLink || !stop.contact_id
    ? null
    : inspLink.state === 'final' ? 'view' : canAccessIrrigation ? 'edit' : null
  const [inspecting, setInspecting] = useState<'edit' | 'view' | null>(null)
  const [lineItemsKey, setLineItemsKey] = useState(0)
  useEffect(() => {
    if (!autoInspect) return
    if (inspMode) setInspecting(inspMode)
    onAutoInspectDone?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoInspect])
  // The phone's Back closes the inspection first, then the stop.
  useEffect(() => {
    if (!inspecting) return
    window.history.pushState({ ...(window.history.state ?? {}), woInsp: stop.id }, '', window.location.href)
    const onPop = () => setInspecting(null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [inspecting, stop.id])
  function closeInspection(changed: boolean) {
    if (window.history.state?.woInsp) window.history.back()
    else setInspecting(null)
    if (changed) {
      onRefresh?.()
      // The inspection may have proposed line items — they're written just after
      // the save returns, so look again a moment later as well.
      setLineItemsKey(k => k + 1)
      setTimeout(() => setLineItemsKey(k => k + 1), 3000)
    }
  }

  // The after-service report opens on top of the stop too (WF / MO stops). A
  // saved one opens to read (with Edit until it is sent); otherwise the draft.
  const reportMode: 'edit' | 'view' | null = !isTreatment || isSkipped || !stop.contact_id
    ? null
    : stop.service_report?.status === 'final' ? 'view' : 'edit'
  const [reporting, setReporting] = useState<'edit' | 'view' | null>(null)
  useEffect(() => {
    if (!autoReport) return
    if (reportMode) setReporting(reportMode)
    onAutoReportDone?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReport])
  useEffect(() => {
    if (!reporting) return
    window.history.pushState({ ...(window.history.state ?? {}), woAsr: stop.id }, '', window.location.href)
    const onPop = () => setReporting(null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [reporting, stop.id])
  function closeReport(changed: boolean) {
    if (window.history.state?.woAsr) window.history.back()
    else setReporting(null)
    if (changed) onRefresh?.()
  }

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

  // 📞 / 💬 — the same two moves as the Lead Tracker's buttons: Call pre-fills
  // the Dialer; Text find-or-creates the customer's Txt thread and opens it.
  function call() {
    if (!stop.client_phone) return
    router.push(`/hub/dialer?number=${encodeURIComponent(stop.client_phone)}`)
  }
  async function text() {
    if (!stop.client_phone || texting) return
    setTexting(true); setTextError(null)
    try {
      const res = await fetch('/api/txt/conversations/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: stop.client_phone, name: stop.client_name || undefined }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.conversation_id) {
        router.push(`/hub/txt/${data.conversation_id}`)
        return // stay busy through the navigation
      }
      setTextError(data?.error || 'Could not open the text thread')
    } catch {
      setTextError('Could not open the text thread')
    }
    setTexting(false)
  }

  const openSkip = () => { setSkipPickerOpen(v => !v); setSelectedReasonId(null); setSelectedReasonLabel(null) }

  return (
    <>
      {inspecting && stop.contact_id && customerHref && (
        <StopInspection
          contactId={stop.contact_id}
          stopId={stop.id}
          inspectionId={stop.inspection?.id ?? null}
          mode={inspecting}
          customerHref={customerHref}
          onClose={closeInspection}
        />
      )}
      {reporting && stop.contact_id && customerHref && (
        <StopServiceReport
          contactId={stop.contact_id}
          stopId={stop.id}
          reportId={stop.service_report?.id ?? null}
          mode={reporting}
          customerHref={customerHref}
          onClose={closeReport}
        />
      )}
      {/* Desktop backdrop — click to close */}
      <div className="hidden md:block fixed inset-0 z-[44] bg-black/50" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Stop ${stop.ord}: ${stop.client_name}`}
        className="fixed inset-x-0 top-0 z-[45] flex flex-col bg-gray-950 md:left-auto md:w-[min(560px,100%)] md:border-l md:border-gray-800 md:shadow-2xl bottom-[var(--wo-sheet-bottom)] md:bottom-0"
        style={{ ['--wo-sheet-bottom' as string]: 'calc(env(safe-area-inset-bottom, 0px) + 56px)' }}
      >
        {/* Header */}
        <div className="flex-none border-b border-gray-800 bg-gray-900 px-3 pb-2 pt-[calc(env(safe-area-inset-top,0px)+8px)] md:pt-3">
          <div className="flex items-start gap-2.5">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close this stop"
              className="flex-none w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div
              className={`flex-none mt-0.5 w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                isComplete ? 'bg-emerald-700 text-emerald-100'
                  : isSkipped ? 'bg-gray-700 text-gray-400'
                  : isInProgress ? 'bg-amber-500 text-amber-50'
                  : 'bg-red-900/40 text-red-300'
              }`}
            >
              {isComplete ? '✓' : isSkipped ? '⊘' : pinLabel(stop.ord)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-white text-base leading-tight truncate">{stop.client_name}</div>
              <div className="text-sm text-gray-400 truncate">{stop.address}</div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 mt-0.5">
                {stop.scheduled_start_at && <span>{formatTime(stop.scheduled_start_at)}</span>}
                {stop.duration_minutes && <span>~{stop.duration_minutes} min</span>}
                {stop.client_phone && <span>{formatPhone(stop.client_phone)}</span>}
                {isComplete && stop.completed_at && <span className="text-emerald-300">✓ Done {formatTime(stop.completed_at)}</span>}
                {isInProgress && stop.arrived_at && (
                  <span className="font-mono text-amber-300">⏱ {formatDuration(now - new Date(stop.arrived_at).getTime())}</span>
                )}
              </div>
            </div>
          </div>

          {/* Icon row */}
          <div className="flex items-start justify-around gap-1 mt-3">
            <ActionIcon
              icon="👤"
              label={stop.contact_id ? 'Customer' : 'No file'}
              href={customerHref}
              disabled={!stop.contact_id}
              tone="indigo"
              title={stop.contact_id ? 'Open the customer file' : 'The Contacts directory has no Jobber link for this customer yet'}
            />
            {isIrrigation && (
              <ActionIcon
                icon="💧"
                label={inspLink ? (inspLink.state === 'final' ? 'Inspection' : inspLink.state === 'draft' ? 'Continue' : 'Inspect') : 'Inspect'}
                href={inspMode ? null : inspLink?.href ?? null}
                onClick={inspMode ? () => setInspecting(inspMode) : undefined}
                disabled={!inspLink}
                tone="cyan"
                title={inspLink?.label ?? 'No customer file is linked to this stop, so the inspection can’t be started from here'}
              />
            )}
            {isTreatment && !isSkipped && (
              <ActionIcon
                icon="📋"
                label={!stop.service_report ? 'Report' : stop.service_report.status === 'draft' ? 'Continue' : 'Report ✓'}
                onClick={reportMode ? () => setReporting(reportMode) : undefined}
                disabled={!reportMode}
                tone="emerald"
                title={reportMode ? 'After-service report for this visit' : 'No customer file is linked to this stop, so the report can’t be started from here'}
              />
            )}
            <ActionIcon icon="🗺️" label="Navigate" href={navHref} external disabled={!navHref} tone="sky" />
            {!isSkipped && (
              <ActionIcon
                icon="🚗"
                label={stop.on_my_way_sent_at ? `Sent ${formatTime(stop.on_my_way_sent_at)}` : 'On my way'}
                onClick={() => setOmwPickerOpen(v => !v)}
                disabled={!stop.client_phone || pending}
                tone={stop.on_my_way_sent_at ? 'sky' : 'amber'}
                title={stop.client_phone ? 'Text the customer you are on the way' : 'No phone number on this stop'}
              />
            )}
            {canCall && (
              <ActionIcon icon="📞" label="Call" onClick={call} disabled={!stop.client_phone} tone="emerald" title={stop.client_phone ? 'Call in the Dialer' : 'No phone number on this stop'} />
            )}
            {canText && (
              <ActionIcon icon="💬" label={texting ? 'Opening…' : 'Text'} onClick={text} disabled={!stop.client_phone || texting} tone="sky" title={stop.client_phone ? 'Open the text thread with this customer' : 'No phone number on this stop'} />
            )}
          </div>
          {textError && <div className="text-xs text-red-300 mt-1 text-center">⚠ {textError}</div>}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-3 text-sm">
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
                        ? 'bg-amber-500 text-[#fff]'
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
                  className="flex-1 px-3 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-[#fff] rounded font-semibold text-sm transition-colors"
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

          {/* Skipped notice */}
          {isSkipped && (
            <div className="bg-gray-800/60 border border-gray-700 rounded px-3 py-2.5 text-sm text-gray-400">
              ⊘ This stop was skipped
              {stop.skip_reason_label && <span className="text-gray-300 ml-1">— {stop.skip_reason_label}</span>}
            </div>
          )}

          {/* Removed from Jobber — kept only because the tech had already worked it */}
          {stop.removed_from_jobber_at && (
            <div className="bg-red-500/10 border border-red-500/30 rounded px-3 py-2.5 text-sm text-red-200">
              ⚠ <strong>This visit is no longer on your day in Jobber</strong> (moved, reassigned or deleted) since {formatTime(stop.removed_from_jobber_at)}. It stays here because you had already started on it — check with the office before doing more.
            </div>
          )}

          {/* Jobber warning */}
          {stop._jobber_warning && (
            <div className="bg-amber-900/30 border border-amber-700/50 text-amber-200 rounded px-2.5 py-2 text-xs">
              ⚠ {stop._jobber_warning}
            </div>
          )}

          {/* A saved inspection can be texted to the customer from here */}
          {isIrrigation && stop.inspection?.status === 'final' && canAccessIrrigation && stop.contact_id && (
            <InspectionTextLink stop={stop} />
          )}

          {/* Job title */}
          {stop.job_title && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Job</div>
              <div className="text-gray-200">{stop.job_title}</div>
            </div>
          )}

          {/* Line items — Work Orders Phase 2: editable, sent to the Jobber visit at Complete */}
          <WorkOrderLineItems key={lineItemsKey} stopId={stop.id} stopStatus={stop.status}
            canSuggest={isIrrigation && stop.inspection?.status === 'final'} />

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
          <StopNotesAndAttachments stopId={stop.id} currentUserId={currentUserId} isAdmin={isAdmin} />

          {/* Time on property */}
          {!isSkipped && (isComplete || isInProgress) && (
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

          {/* Products-used record link */}
          {stop.pesticide_record_id && (
            <a
              href={`/hub/pesticide-records/${stop.pesticide_record_id}`}
              className="block bg-emerald-500/5 border border-emerald-500/30 rounded px-3 py-2 text-xs text-emerald-200 hover:bg-emerald-500/10 transition-colors"
            >
              🧪 Products used — view record →
            </a>
          )}

          {/* Pesticide notes + after-service report — WF / MO stops only (Ben, Oct 2 2026) */}
          {!isSkipped && isTreatment && (
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
          {!isSkipped && isTreatment && (
            <button
              type="button"
              onClick={reportMode ? () => setReporting(reportMode) : undefined}
              disabled={!reportMode}
              className="w-full text-left bg-emerald-500/5 border border-emerald-500/30 rounded px-3 py-2.5 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-emerald-100">📋 After-service report</span>
                <span className="text-xs text-emerald-300">
                  {!stop.contact_id ? 'Needs a customer file' : !stop.service_report ? 'Fill out ›' : stop.service_report.status === 'draft' ? 'Continue draft ›' : stop.service_report.sent_at ? '✓ Sent · View ›' : '✓ Saved · View ›'}
                </span>
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">What was done, what you saw, recommendations, photos — and confirm the products applied.</div>
            </button>
          )}
        </div>

        {/* Bottom action bar */}
        <div className="flex-none border-t border-gray-800 bg-gray-900 px-3 pt-2 pb-2">
          {skipPickerOpen && !isComplete && !isSkipped && (
            <div className="mb-2 max-h-[45vh] overflow-y-auto bg-gray-950/70 border border-gray-700 rounded p-3 space-y-2">
              <div className="text-xs text-gray-400 mb-1.5">Why is this stop being skipped?</div>
              {skipReasons.length === 0 ? (
                <EmptyState size="sm" title="No reason codes configured. Contact your admin." />
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
          <div className="flex items-start justify-around gap-2">
            {!isComplete && !isInProgress && !isSkipped && (
              <>
                <ActionIcon icon="▶" label={pending ? 'Starting…' : 'Arrived'} onClick={() => onArrive(stop.id, false)} disabled={pending} tone="amber" title="Arrived at the property — starts the timer" />
                <ActionIcon icon="✓" label={pending ? 'Saving…' : 'Complete'} onClick={() => onComplete(stop.id, false)} disabled={pending} tone="emerald" title="Mark complete without the timer — also marks the visit done in Jobber" />
                <ActionIcon icon="⊘" label="Skip" onClick={openSkip} disabled={pending} title="Skip this stop" />
              </>
            )}
            {isInProgress && (
              <>
                <ActionIcon icon="✓" label={pending ? 'Saving…' : 'Complete'} onClick={() => onComplete(stop.id, false)} disabled={pending} tone="emerald" title="Mark complete — also marks the visit done in Jobber" />
                <ActionIcon icon="⊘" label="Skip" onClick={openSkip} disabled={pending} title="Skip this stop" />
                <ActionIcon icon="↺" label="Reset time" onClick={() => onArrive(stop.id, true)} disabled={pending} title="Reset the arrival time" />
              </>
            )}
            {isComplete && (
              <ActionIcon icon="↩" label={pending ? 'Reopening…' : 'Reopen'} onClick={() => onComplete(stop.id, true)} disabled={pending} title="Reopen this stop — also flips the visit back in Jobber" />
            )}
            {isSkipped && (
              <ActionIcon icon="↩" label={pending ? 'Undoing…' : 'Undo skip'} onClick={() => onSkip(stop.id, true)} disabled={pending} title="Undo the skip" />
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/** Text a saved irrigation inspection's customer link from the stop. */
function InspectionTextLink({ stop }: { stop: Stop }) {
  const [texting, setTexting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const insp = stop.inspection

  async function textLink() {
    if (texting || !stop.contact_id || !insp || insp.status !== 'final') return
    setTexting(true); setToast(null)
    try {
      const res = await fetch(`/api/hub/contacts/${stop.contact_id}/irrigation/${insp.id}/text`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      setToast(res.ok ? '✓ Report link texted to the customer' : (j.error || 'Could not send'))
    } catch { setToast('Could not send') } finally { setTexting(false) }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={textLink}
        disabled={texting}
        className="text-xs px-2.5 py-1.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-100 disabled:opacity-50 transition-colors"
      >
        {texting ? 'Sending…' : '💧 Text the customer the inspection link'}
      </button>
      {insp?.share_url && (
        <a href={insp.share_url} target="_blank" rel="noopener noreferrer" className="text-xs px-2.5 py-1.5 rounded bg-white/10 hover:bg-white/20 text-gray-400 transition-colors">
          View customer link ↗
        </a>
      )}
      {toast && <span className="text-xs text-emerald-300">{toast}</span>}
    </div>
  )
}

// ── StopNotesAndAttachments ───────────────────────────────────────────────────

type ThreadItem =
  | { kind: 'message'; id: string; content: string; created_at: string; edited_at: string | null; user: StopMessage['user']; reactions: StopReaction[] }
  | { kind: 'file'; id: string; file_name: string; file_type: string | null; file_size: number | null; file_url: string; created_at: string; uploaded_by: string | null }

type PendingFile = { file: File; previewUrl: string | null }

function StopNotesAndAttachments({
  stopId,
  currentUserId,
  isAdmin,
}: {
  stopId: string
  currentUserId: string
  /** A Daily Log admin may edit or delete anyone's note; everyone else only their own. */
  isAdmin: boolean
}) {
  const [messages, setMessages] = useState<StopMessage[]>([])
  const [attachments, setAttachments] = useState<StopAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [sending, setSending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const [attachOpen, setAttachOpen] = useState(false)
  // ⚠ Read in an effect, never during render: isNativeApp() looks at window, so
  // deciding this on the server would hydrate the wrong control.
  const [nativeAttach, setNativeAttach] = useState(false)
  // ⚠ Shown on any TOUCH device, not just "is this the native app". The native
  // check reads a localStorage flag the shell writes on page load, so it is one
  // missing write away from the menu silently never appearing — and an invisible
  // control is indistinguishable from the bug it was meant to fix. A coarse
  // pointer means a phone or tablet, which is exactly where a camera is wanted,
  // and it covers the mobile browser too. Desktop keeps the plain file dialog.
  useEffect(() => {
    setNativeAttach(isNativeApp() ||
      (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true))
  }, [])
  useOutsideClose(attachMenuRef, attachOpen, () => setAttachOpen(false))
  // ⚠ The thread box scrolls ITSELF to the newest note. It used to call
  // scrollIntoView on a marker at the bottom, which scrolls every scrollable
  // ancestor too — so opening a stop yanked the whole screen down to the note
  // box (Ben, Oct 2 2026). Setting scrollTop moves only this box.
  const listRef = useRef<HTMLDivElement>(null)

  // Edit / delete a note (Ben, Oct 2 2026). One note in edit at a time.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  async function saveEdit(messageId: string) {
    const content = editText.trim()
    if (!content || editBusy) return
    setEditBusy(true); setNoteError(null)
    try {
      const res = await fetch(`/api/hub/daily-log/stops/${stopId}/messages/${messageId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.message) { setNoteError(j.error || 'Could not save the change'); return }
      setMessages(prev => prev.map(m => (m.id === messageId ? (j.message as StopMessage) : m)))
      setEditingId(null)
    } catch { setNoteError('Could not save the change') } finally { setEditBusy(false) }
  }

  async function deleteNote(messageId: string) {
    if (!window.confirm('Delete this note?')) return
    setNoteError(null)
    try {
      const res = await fetch(`/api/hub/daily-log/stops/${stopId}/messages/${messageId}`, { method: 'DELETE' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setNoteError(j.error || 'Could not delete the note'); return }
      setMessages(prev => prev.filter(m => m.id !== messageId))
      if (editingId === messageId) setEditingId(null)
    } catch { setNoteError('Could not delete the note') }
  }

  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null)

  // Emoji reactions on a note — one picker open at a time; optimistic, then the
  // server's list replaces ours.
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null)
  const reactionPickerRef = useRef<HTMLDivElement>(null)
  useOutsideClose(reactionPickerRef, reactionPickerId !== null, () => setReactionPickerId(null))
  async function toggleReaction(messageId: string, emoji: string) {
    setReactionPickerId(null)
    setMessages(prev => prev.map(m => {
      if (m.id !== messageId) return m
      const rx = m.reactions ?? []
      const mine = rx.some(r => r.user_id === currentUserId && r.emoji === emoji)
      return { ...m, reactions: mine ? rx.filter(r => !(r.user_id === currentUserId && r.emoji === emoji)) : [...rx, { user_id: currentUserId, emoji }] }
    }))
    try {
      const res = await fetch(`/api/hub/daily-log/stops/${stopId}/messages/${messageId}/reactions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emoji }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(j.reactions)) {
        setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, reactions: j.reactions as StopReaction[] } : m)))
      }
    } catch { /* the optimistic state stands until the next load */ }
  }

  // Image + PDF attachments open in the in-app viewer (MediaLightbox) so they work
  // on every platform including the iOS/Android apps. The old window.open('','_blank')
  // gesture-popup returns null in the iOS Capacitor webview, so attachments never
  // opened there. Other file types fall back to a same-origin download link.
  const lightboxItems = useMemo<LightboxItem[]>(() =>
    attachments
      .filter(a => !!a.file_type && (a.file_type.startsWith('image/') || a.file_type === 'application/pdf'))
      .map(a => {
        const isPdf = a.file_type === 'application/pdf'
        return {
          type: (isPdf ? 'pdf' : 'image') as 'pdf' | 'image',
          src: isPdf ? `${a.file_url}?inline=pdf` : a.file_url,
          downloadSrc: a.file_url,
          filename: a.file_name,
        }
      }), [attachments])
  const lightboxIndexById = useMemo<Record<string, number>>(() => {
    const m: Record<string, number> = {}
    attachments
      .filter(a => !!a.file_type && (a.file_type.startsWith('image/') || a.file_type === 'application/pdf'))
      .forEach((a, i) => { m[a.id] = i })
    return m
  }, [attachments])

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
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, attachments.length])

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
      ...messages.map(m => ({ kind: 'message' as const, id: m.id, content: m.content, created_at: m.created_at, edited_at: m.edited_at ?? null, user: m.user, reactions: m.reactions ?? [] })),
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
        <div className="py-6 text-center"><Spinner size={5} /></div>
      ) : (
        <div ref={listRef} className="space-y-2 mb-2 max-h-64 overflow-y-auto">
          {threadItems.length === 0 && (
            <EmptyState size="sm" title="No notes or attachments yet." />
          )}
          {threadItems.map(item => {
            if (item.kind === 'message') {
              const isMine = item.user?.id === currentUserId
              const canModify = isMine || isAdmin
              const isEditing = editingId === item.id
              const initials = item.user ? item.user.display_name.split(/\s+/).map(n => n[0]).join('').slice(0, 2).toUpperCase() : '?'
              return (
                <div key={`m-${item.id}`} className={`flex gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
                  <div className="flex-none w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-[10px] text-gray-300 font-semibold">
                    {initials}
                  </div>
                  <div className="max-w-[82%] min-w-0">
                    <div className={`rounded px-2.5 py-1.5 text-xs ${isMine ? 'bg-sky-600/25 text-sky-100' : 'bg-gray-800 text-gray-200'}`}>
                      <div className="font-medium text-[10px] opacity-60 mb-0.5">
                        {item.user?.display_name ?? 'Unknown'} · {formatTime(item.created_at)}{item.edited_at ? ' · (edited)' : ''}
                      </div>
                      {isEditing ? (
                        <div className="space-y-1.5">
                          <textarea
                            value={editText}
                            onChange={e => setEditText(e.target.value)}
                            rows={3}
                            autoFocus
                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-base md:text-xs text-white outline-none focus:border-sky-500 resize-y"
                          />
                          <div className="flex justify-end gap-1.5">
                            <button type="button" onClick={() => setEditingId(null)} disabled={editBusy} className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-[11px]">Cancel</button>
                            <button type="button" onClick={() => saveEdit(item.id)} disabled={editBusy || !editText.trim()} className="px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-[#fff] text-[11px] font-medium">{editBusy ? 'Saving…' : 'Save'}</button>
                          </div>
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap">{item.content}</div>
                      )}
                    </div>
                    {/* Reactions: grouped pills (tap to toggle yours) + a small picker */}
                    <div className={`flex flex-wrap items-center gap-1 mt-1 ${isMine ? 'justify-end' : ''}`}>
                      {(() => {
                        const groups: Record<string, string[]> = {}
                        for (const r of item.reactions) (groups[r.emoji] ??= []).push(r.user_id)
                        return Object.entries(groups).map(([emoji, ids]) => {
                          const mine = ids.includes(currentUserId)
                          return (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => toggleReaction(item.id, emoji)}
                              className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors ${
                                mine ? 'bg-sky-500/20 border-sky-400/50 text-sky-200' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                              }`}
                              title={mine ? 'Remove your reaction' : 'React too'}
                            >
                              <span>{emoji}</span><span className="font-medium">{ids.length}</span>
                            </button>
                          )
                        })
                      })()}
                      <div className="relative" ref={reactionPickerId === item.id ? reactionPickerRef : undefined}>
                        <button
                          type="button"
                          onClick={() => setReactionPickerId(prev => (prev === item.id ? null : item.id))}
                          className="w-6 h-6 flex items-center justify-center rounded-full text-gray-500 hover:text-white hover:bg-gray-700 text-xs"
                          title="Add a reaction"
                          aria-label="Add a reaction"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                        {reactionPickerId === item.id && (
                          <div className={`absolute bottom-full ${isMine ? 'right-0' : 'left-0'} mb-1 z-30 flex items-center gap-0.5 bg-gray-900 border border-gray-700 rounded-full shadow-2xl px-1.5 py-1`}>
                            {STOP_REACTION_CHOICES.map(emoji => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => toggleReaction(item.id, emoji)}
                                className="w-7 h-7 flex items-center justify-center text-base rounded-full hover:bg-gray-800"
                                title={`React with ${emoji}`}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {canModify && !isEditing && (
                        <>
                          <button
                            type="button"
                            onClick={() => { setEditingId(item.id); setEditText(item.content); setNoteError(null) }}
                            className="w-6 h-6 flex items-center justify-center rounded-full text-gray-500 hover:text-white hover:bg-gray-700 text-[11px]"
                            title="Edit this note"
                            aria-label="Edit this note"
                          >✏️</button>
                          <button
                            type="button"
                            onClick={() => deleteNote(item.id)}
                            className="w-6 h-6 flex items-center justify-center rounded-full text-gray-500 hover:text-white hover:bg-gray-700 text-[11px]"
                            title="Delete this note"
                            aria-label="Delete this note"
                          >🗑️</button>
                        </>
                      )}
                    </div>
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
                  {(isImage(item.file_type) || item.file_type === 'application/pdf') ? (
                    <button
                      type="button"
                      onClick={() => setLightbox({ items: lightboxItems, index: lightboxIndexById[item.id] ?? 0 })}
                      className="max-w-[60%] block text-left bg-gray-800 border border-gray-700 rounded overflow-hidden hover:border-sky-600 transition-colors"
                    >
                      {isImage(item.file_type) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.file_url} alt={item.file_name} className="w-full h-24 object-cover" />
                      ) : (
                        <div className="w-full h-16 flex items-center justify-center text-2xl select-none">📄</div>
                      )}
                      <div className="px-2 py-1 text-[10px] text-gray-400 truncate">{item.file_name}</div>
                    </button>
                  ) : (
                    <a
                      href={item.file_url}
                      className="max-w-[60%] block text-left bg-gray-800 border border-gray-700 rounded overflow-hidden hover:border-sky-600 transition-colors"
                    >
                      <div className="w-full h-16 flex items-center justify-center text-2xl select-none">
                        {isVideo(item.file_type) ? '🎥' : '📄'}
                      </div>
                      <div className="px-2 py-1 text-[10px] text-gray-400 truncate">{item.file_name}</div>
                    </a>
                  )}
                </div>
              )
            }
          })}
        </div>
      )}

      {noteError && <div className="text-xs text-red-300 mb-2">⚠ {noteError}</div>}

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
                aria-label="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="flex gap-2 items-end">
        {/* ⚠⚠ On a phone the paperclip used to go straight to the FILE PICKER
            with no way to reach the camera — which is backwards for a crew
            standing at the property. The cause is the accept list: a mixed
            image+pdf+video list makes Android offer documents only. A camera
            needs its own input with capture=, so the choice has to be made
            BEFORE the picker opens, not inside it.
            Native only: on a desktop, capture= is ignored and a three-way
            menu would just be an extra click in front of the same dialog. */}
        <div className="relative flex-none" ref={attachMenuRef}>
          <button
            onClick={() => (nativeAttach ? setAttachOpen(o => !o) : fileRef.current?.click())}
            className="px-2.5 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded transition-colors text-sm"
            title="Attach photo or file"
            aria-haspopup={nativeAttach ? 'menu' : undefined}
            aria-expanded={nativeAttach ? attachOpen : undefined}
          >
            📎
          </button>
          {nativeAttach && attachOpen && (
            <div
              role="menu"
              className="absolute bottom-full left-0 mb-1 z-20 w-44 bg-gray-800 border border-gray-700 rounded shadow-lg overflow-hidden"
            >
              {([
                ['📷', 'Take photo', photoRef],
                ['🎥', 'Record video', videoRef],
                ['📁', 'Choose a file', fileRef],
              ] as const).map(([icon, label, ref]) => (
                <button
                  key={label}
                  role="menuitem"
                  onClick={() => { setAttachOpen(false); ref.current?.click() }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-200 hover:bg-gray-700"
                >
                  <span aria-hidden>{icon}</span>{label}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* capture="environment" = the rear camera, opened directly. Verified on
            the Pixel only after a <queries> block was added to the manifest —
            without it Android 11+ hides the camera app and Capacitor concludes
            the phone has none, silently falling back to the gallery. */}
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={e => {
            if (e.target.files?.length) stageFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <input
          ref={videoRef}
          type="file"
          accept="video/*"
          capture="environment"
          className="hidden"
          onChange={e => {
            if (e.target.files?.length) stageFiles(e.target.files)
            e.target.value = ''
          }}
        />
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
          className="flex-none px-3 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-[#fff] rounded text-sm font-medium transition-colors self-end"
        >
          {sending ? '…' : '↑'}
        </button>
      </div>

      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}
