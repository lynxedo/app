'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import DispatchMap, { type DispatchMapLeg, type DispatchMapStop } from '@/components/DispatchMap'
import DispatchCalendar, { type EffStop, type RangeStop } from '@/components/DispatchCalendar'
import DispatchRoutePanel, { type OptimizeRequest, type PanelLane, TICKS_EVENT, readPanelOff, sendLasso } from '@/components/DispatchRoutePanel'
import { resolvePinColors, type PinSettings } from '@/lib/pin-colors'
import DispatchTankPanel, { tankRouteCode } from '@/components/DispatchTankPanel'
import DispatchAddonStripe from '@/components/DispatchAddonStripe'
import DispatchLegend from '@/components/DispatchLegend'
import type { CapacityData } from '@/lib/route-capacity'
import { fetchLeg, type Leg, type LatLng } from '@/lib/dispatch-legs'
import { computeDuration } from '@/lib/route-duration'
import { buildAdvancedRouteSheetHtml, type RouteSheetStop } from '@/lib/advanced-route-sheet'
import type { DurationRulesConfig } from '@/app/api/settings/types'
import {
  type DispatchSettings, type DispatchStop, type DispatchLock, type DraftChange,
  type DatePreset, type DispatchFilters, type DispatchViewConfig, DATE_PRESETS, matchesItemFilter, normalizeViewConfig, resolveViewDate,
  DEFAULT_DISPATCH_SETTINGS, LANE_COLORS, addDays, changeDate, fmtClock, hhmmToMinutes, insertInOrder, isoToLocal, orderRoute,
  localStamp, localToIso, parseTitleWindow, remindersAlreadySent, stopColor, stopMatchesGroup, todayLocal,
} from '@/lib/dispatch'

// Dispatch — the third routing mode (Reference/PRDs/DISPATCH_ROUTING_PRD.md),
// for appointment-window days: a few stops per tech, several techs, customers
// who need to be home. One lane per technician on a timeline, the real drive
// path on the map, the Unscheduled bucket, and drag to retime / reassign /
// schedule. Moves build a saved DRAFT (undoable); "Send to Jobber" re-checks
// each stop live and writes through the Route Optimizer's own writer
// (/api/send-to-jobber). Jobber stays the schedule of record.

interface JobberUser { id: string; name: string }

interface TechSettingRow {
  jobber_user_id: string
  start_kind: 'depot' | 'address'; start_lat: number | null; start_lng: number | null; start_address: string | null
  end_kind: 'depot' | 'address'; end_lat: number | null; end_lng: number | null; end_address: string | null
}

interface DayData {
  date: string
  stops: DispatchStop[]
  locks: DispatchLock[]
  errors: Array<{ techId: string; error: string }>
  truncated: boolean
  draft: { changes: DraftChange[]; updatedByName: string | null; updatedAt: string; mine: boolean } | null
  depot: { lat: number; lng: number; address: string | null } | null
  duration: { method: string; defaultMinutes: number; rules: DurationRulesConfig }
  settings: DispatchSettings
  techSettings: TechSettingRow[]
}

interface Placed {
  stop: DispatchStop
  lane: string
  startMin: number | null   // null = anytime / not on the clock
  endMin: number | null
  durationMin: number
  changed: boolean
  fromBucket: boolean
  lock: { startMin: number; endMin: number } | null
  color: string
  /** Add-on program colors (Pin Colors aux) — right-edge stripes / pin halo. */
  addons: string[]
  dim: boolean               // filtered out — kept on the route so the drive stays true
}

/** Everything Optimize needs to know about one stop on the day being optimized. */
export interface OptCtxStop {
  stop: DispatchStop
  startMin: number | null
  durationMin: number | null   // null = let the server work it out from the duration rules
  lock: { startMin: number; endMin: number } | null
  lane: string
  lat: number | null
  lng: number | null
}

interface LaneRoute {
  techId: string
  start: LatLng | null
  end: LatLng | null
  /** Every stop with an address on the map, in ROUTE order (Hub order, else time
   *  then anytime) — numbered 1..n; the map path and route sheet follow it. */
  route: Placed[]
  num: Map<string, number>   // stop id → route number
  timed: Placed[]            // on the clock — drawn as blocks on the timeline
  tray: Placed[]             // anytime or no address
  legs: Leg[] | null         // start→route[0], route[0]→route[1], … → end
}

const SNAP = 15
const LS_TEAM = 'lynxedo-dispatch-team'
const LS_FILTERS = 'lynxedo-dispatch-filters'
const LS_VIEW = 'lynxedo-dispatch-view'
const LS_BUCKET = 'lynxedo-dispatch-bucket'
const LS_TANKS = 'lynxedo-dispatch-tanks'
const LS_ACTIVE_VIEW = 'lynxedo-dispatch-active-view'
const LS_PIN_NUMBERS = 'lynxedo-dispatch-pin-numbers'
// The map grows with the window (big / ultra-wide screens), never below 520px.
const MAP_HEIGHT = 'max(520px, calc(100vh - 380px))'

const minutesOf = (local: string) => Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16))
const money = (n: number) => `$${Math.round(n).toLocaleString()}`

function haversineMi(a: LatLng, b: LatLng): number {
  const R = 3958.8, r = Math.PI / 180
  const x = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' })

/** "10 am → 1:30 pm", or "Mon 10/20 → Wed 10/22, anytime" when the day changes. */
function describeMove(c: DraftChange): string {
  const was = c.fromStartAt ? isoToLocal(c.fromStartAt) : null
  const to = changeDate(c)
  const wasTime = was && was.minutes > 0 ? fmtClock(was.minutes) : 'anytime'
  const toTime = c.anytime ? 'anytime' : fmtClock(minutesOf(c.toStart))
  if (!was) return `unscheduled → ${shortDay(to)}, ${toTime}`
  if (was.date !== to) return `${shortDay(was.date)} ${wasTime} → ${shortDay(to)}, ${toTime}`
  return `${wasTime} → ${toTime}`
}

function stepDate(date: string, view: 'day' | 'week' | 'month', dir: 1 | -1): string {
  if (view === 'day') return addDays(date, dir)
  if (view === 'week') return addDays(date, 7 * dir)
  const [y, m] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + dir, 1))
  return t.toISOString().slice(0, 10)
}

function readLS<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback } catch { return fallback }
}
function writeLS(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }

export default function DispatchView() {
  const router = useRouter()
  const [date, setDate] = useState(() => todayLocal())
  const [view, setView] = useState<'day' | 'week' | 'month'>('day')
  // Unscheduled panel can be hidden for more calendar/map room (Ben, Oct 2026).
  const [showBucket, setShowBucket] = useState(true)
  const [users, setUsers] = useState<JobberUser[]>([])
  const [team, setTeam] = useState<string[] | null>(null)
  const [teamOpen, setTeamOpen] = useState(false)

  const [day, setDay] = useState<DayData | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [bucket, setBucket] = useState<DispatchStop[]>([])
  const [bucketLoading, setBucketLoading] = useState(false)
  const [bucketError, setBucketError] = useState<string | null>(null)
  const [bucketSort, setBucketSort] = useState<'oldest' | 'value' | 'nearest'>('oldest')
  const [bucketSearch, setBucketSearch] = useState('')
  const [bucketTeamOnly, setBucketTeamOnly] = useState(true)
  const [bucketAt, setBucketAt] = useState(0)

  const [coords, setCoords] = useState<Record<string, LatLng | null>>({})
  const [changes, setChanges] = useState<DraftChange[]>([])
  // One draft across every day (Oct 20 2026) — loaded on its own, not with a day.
  const [draftMeta, setDraftMeta] = useState<{ updatedByName: string | null; mine: boolean } | null>(null)
  // Settings load on their own too, so Week/Month have colors + chips without a Day load.
  const [baseSettings, setBaseSettings] = useState<DispatchSettings | null>(null)
  const [baseTechSettings, setBaseTechSettings] = useState<TechSettingRow[]>([])
  const [showRoutePanel, setShowRoutePanel] = useState(true)
  // Halo rings = Admin → Routing → Pin Colors add-on programs (same as Advanced).
  const [pinSettings, setPinSettings] = useState<PinSettings | null>(null)
  // Stops unticked in Route & optimize, per day — faded on the map.
  const [tickOff, setTickOff] = useState<Record<string, string[]>>({})
  // Days since each stop's last completed visit ("18d") + what map pins number by.
  const [lastDays, setLastDays] = useState<Record<string, number | null>>({})
  const [pinNumbers, setPinNumbers] = useState<'route' | 'last'>('route')
  // Tank loadout — hidden until asked for (Ben, Oct 20 2026).
  const [showTanks, setShowTanks] = useState(false)
  const [capacity, setCapacity] = useState<CapacityData | null>(null)
  const capLoading = useRef(false)
  const loadCapacity = useCallback(() => {
    if (capLoading.current) return
    capLoading.current = true
    fetch('/api/hub/routing/capacity-data').then(r => r.json())
      .then(d => { if (d.tanks) setCapacity({ tanks: d.tanks, serviceProducts: d.serviceProducts ?? [], products: d.products ?? [] }) })
      .catch(() => {})
      .finally(() => { capLoading.current = false })
  }, [])
  // Hub route order per "date|techId" (Jobber can't order anytime visits).
  const [orders, setOrders] = useState<Record<string, string[]>>({})
  // Bumped after a send so Week/Month re-read Hub's copy of Jobber.
  const [calTick, setCalTick] = useState(0)
  const historyRef = useRef<DraftChange[][]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [locks, setLocks] = useState<Record<string, DispatchLock>>({})

  const [filters, setFilters] = useState<DispatchFilters>({ groups: [], hideZero: false, items: [], hideDone: false })
  // Saved views (Ben, Oct 20 2026) + the line-item catalog for the filter.
  const [views, setViews] = useState<Array<{ id: string; name: string; config: DispatchViewConfig; shared: boolean; mine: boolean }>>([])
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [saveViewOpen, setSaveViewOpen] = useState(false)
  const [catalog, setCatalog] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Week/Month: the stop whose customer box is open, found in the days as the
  // calendar draws them so the box follows the stop when the draft moves it.
  const [calDays, setCalDays] = useState<Record<string, EffStop[]>>({})
  const [calSelId, setCalSelId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [windowPrompt, setWindowPrompt] = useState<null | { stopId: string; lane: string; startMin: number; lock: { startMin: number; endMin: number } }>(null)
  const [routes, setRoutes] = useState<Record<string, Leg[]>>({})
  const [optimizing, setOptimizing] = useState(false)
  const [optPreview, setOptPreview] = useState<null | {
    date: string
    results: Array<{
      techId: string; skipped?: string; order?: string[]; starts?: Record<string, number>
      driveMin?: number; beforeDriveMin?: number; estimated?: boolean; grouped?: number
      violations?: Array<{ id: string; kind: 'window' | 'hours'; lateMin: number }>
    }>
    ctx: Record<string, OptCtxStop>
    /** Each lane's full route before optimizing — unticked stops keep their place. */
    routeIds: Record<string, string[]>
  }>(null)
  const [slots, setSlots] = useState<null | {
    stopId: string; loading: boolean; error?: string; note?: string
    window: { start: number; end: number; label: string } | null
    options: Array<{ date: string; techId: string; startMin: number; addedMin: number; afterAddress: string | null; beforeAddress: string | null; emptyDay: boolean }>
  }>(null)
  const [ghost, setGhost] = useState<null | { date: string; lane: string; startMin: number; durationMin: number; stopId: string }>(null)
  const [pendingPlace, setPendingPlace] = useState<null | { date: string; stopId: string; lane: string; startMin: number }>(null)
  const [remOpen, setRemOpen] = useState(false)
  const [rem, setRem] = useState<null | {
    loading: boolean; error?: string; date?: string; enabled?: boolean; sendTime?: string; ownerSet?: boolean; templates?: number
    items?: Array<{
      jobberItemId: string; kind: string; clientName: string; title: string; timed: boolean
      window: { start: number; end: number; source: string } | null
      template: { id: string; name: string } | null
      sms: { to: string; body: string } | null
      email_msg: { to: string; subject: string; body: string } | null
      skip: string | null
    }>
    log?: Array<{ jobber_item_id: string; channel: string; status: string; error: string | null }>
  }>(null)
  const [remSample, setRemSample] = useState<Record<string, string>>({})
  const [sheetMsg, setSheetMsg] = useState<Record<string, { busy?: boolean; ok?: boolean; text: string }>>({})

  const [sendOpen, setSendOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendReport, setSendReport] = useState<null | {
    ok: Array<{ change: DraftChange; remind: boolean }>
    failed: Array<{ change: DraftChange; error: string }>
    conflicts: Array<{ change: DraftChange; reason: string }>
    unchecked: number
  }>(null)

  const settings = day?.settings ?? baseSettings ?? DEFAULT_DISPATCH_SETTINGS
  const viewStart = hhmmToMinutes(settings.view_start)
  const viewEnd = Math.max(viewStart + 60, hhmmToMinutes(settings.view_end))
  const span = viewEnd - viewStart

  // ── Load: users, team, filters ────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/hub/routing/dispatch/users').then(r => r.json()).then(d => setUsers(d.users ?? [])).catch(() => {})
    { const f = readLS<Partial<DispatchFilters>>(LS_FILTERS, {}); setFilters({ groups: f.groups ?? [], hideZero: !!f.hideZero, items: f.items ?? [], hideDone: !!f.hideDone }) }
    setActiveViewId(readLS<string | null>(LS_ACTIVE_VIEW, null))
    void loadViews()
    setShowBucket(readLS<boolean>(LS_BUCKET, true))
    setShowTanks(readLS<boolean>(LS_TANKS, false))
    setPinNumbers(readLS<'route' | 'last'>(LS_PIN_NUMBERS, 'route') === 'last' ? 'last' : 'route')
    const v = readLS<string>(LS_VIEW, 'day')
    if (v === 'week' || v === 'month') setView(v)
    const saved = readLS<string[] | null>(LS_TEAM, null)
    if (saved && saved.length) setTeam(saved)
    fetch('/api/hub/routing/dispatch/settings').then(r => r.json())
      .then(d => {
        if (d.settings) setBaseSettings(d.settings as DispatchSettings)
        if (Array.isArray(d.techSettings)) setBaseTechSettings(d.techSettings as TechSettingRow[])
        if (Array.isArray(d.lineItems)) setCatalog(d.lineItems as string[])
        // No personal choice yet — use the company default from Dispatch settings.
        if (!(saved && saved.length)) setTeam((d.settings?.default_team as string[] | undefined) ?? [])
      })
      .catch(() => { if (!(saved && saved.length)) setTeam([]) })
    void loadDraft()
    fetch('/api/routing/pin-settings').then(r => r.json()).then(d => { if (d.pin_settings) setPinSettings(d.pin_settings as PinSettings) }).catch(() => {})
    const onTicks = (e: Event) => {
      const d = (e as CustomEvent<{ date: string; off: string[] }>).detail
      if (d) setTickOff(prev => ({ ...prev, [d.date]: d.off }))
    }
    window.addEventListener(TICKS_EVENT, onTicks)
    return () => window.removeEventListener(TICKS_EVENT, onTicks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadDraft = useCallback(async () => {
    try {
      const res = await fetch('/api/hub/routing/dispatch/draft')
      const d = await res.json()
      if (!res.ok) return
      setChanges(d.changes ?? [])
      setDraftMeta({ updatedByName: d.updatedByName ?? null, mine: !!d.mine })
      historyRef.current = []
      setCanUndo(false)
    } catch {}
  }, [])

  const saveOrder = useCallback((d: string, techId: string, ids: string[]) => {
    setOrders(o => ({ ...o, [`${d}|${techId}`]: ids }))
    fetch('/api/hub/routing/dispatch/order', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: d, techId, ids }),
    }).then(r => { if (!r.ok) setNotice("Couldn't save the stop order — try again.") })
      .catch(() => setNotice("Couldn't save the stop order — check your connection."))
  }, [])

  const userName = useCallback((id: string) => users.find(u => u.id === id)?.name ?? 'Unknown tech', [users])

  const loadDay = useCallback(async () => {
    if (!team || team.length === 0) { setDay(null); return }
    setLoading(true); setLoadError(null)
    try {
      const res = await fetch(`/api/hub/routing/dispatch/day?date=${date}&techIds=${encodeURIComponent(team.join(','))}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || `Couldn't load the day (${res.status})`)
      setDay(d as DayData)
      fetch(`/api/hub/routing/dispatch/order?from=${date}&to=${date}&techIds=${encodeURIComponent(team.join(','))}`)
        .then(r => r.json()).then(o => setOrders(prev => ({ ...prev, ...(o.orders ?? {}) }))).catch(() => {})
      const lm: Record<string, DispatchLock> = {}
      for (const l of (d as DayData).locks) lm[l.jobber_item_id] = l
      setLocks(lm)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [date, team])

  // Week/Month read Hub's copy; only the Day view needs the live Jobber pull.
  useEffect(() => { if (view === 'day') void loadDay() }, [loadDay, view])

  const loadBucket = useCallback(async (refresh = false) => {
    setBucketLoading(true); setBucketError(null)
    try {
      const res = await fetch(`/api/hub/routing/dispatch/unscheduled${refresh ? '?refresh=1' : ''}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not load unscheduled visits')
      setBucket(d.stops ?? [])
      setBucketAt(Date.now())
    } catch (e) {
      setBucketError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setBucketLoading(false)
    }
  }, [])
  useEffect(() => { void loadBucket() }, [loadBucket])

  // ── Geocode every address we show (server geocoder + cache, same as the optimizer)
  useEffect(() => {
    const want = new Set<string>()
    for (const s of day?.stops ?? []) if (s.routable && s.address && !(s.address in coords)) want.add(s.address)
    for (const s of bucket) if (s.routable && s.address && !(s.address in coords)) want.add(s.address)
    const list = [...want]
    if (list.length === 0) return
    let cancelled = false
    ;(async () => {
      for (let i = 0; i < list.length; i += 40) {
        const chunk = list.slice(i, i + 40)
        try {
          const res = await fetch('/api/geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addresses: chunk }) })
          const d = await res.json()
          if (cancelled) return
          const got: Record<string, LatLng | null> = {}
          chunk.forEach((a, j) => { got[a] = d.coords?.[j] ?? null })
          setCoords(prev => ({ ...prev, ...got }))
        } catch {
          if (cancelled) return
          const got: Record<string, LatLng | null> = {}
          chunk.forEach(a => { got[a] = null })
          setCoords(prev => ({ ...prev, ...got }))
        }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, bucket])

  // Days since last visit for the day's visits (Hub's copy of Jobber).
  const dayIdsKey = (day?.stops ?? []).filter(s => s.kind === 'visit').map(s => s.id).join(',')
  useEffect(() => {
    if (!dayIdsKey) return
    let cancelled = false
    fetch('/api/hub/routing/dispatch/last-visits', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitIds: dayIdsKey.split(',') }),
    }).then(r => r.json()).then(d => { if (!cancelled) setLastDays(prev => ({ ...prev, ...(d.days ?? {}) })) }).catch(() => {})
    return () => { cancelled = true }
  }, [dayIdsKey])

  // ── Draft persistence ─────────────────────────────────────────────────────
  const saveTimer = useRef<number | null>(null)
  const saveDraft = useCallback((next: DraftChange[]) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      fetch('/api/hub/routing/dispatch/draft', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: next }),
      }).then(r => { if (!r.ok) setNotice("Couldn't save the draft — your changes are still on screen; try again.") })
        .catch(() => setNotice("Couldn't save the draft — check your connection."))
    }, 350)
  }, [])

  const commit = useCallback((next: DraftChange[]) => {
    historyRef.current.push(changes)
    if (historyRef.current.length > 100) historyRef.current.shift()
    setCanUndo(true)
    setChanges(next)
    saveDraft(next)
  }, [changes, saveDraft])

  const undo = () => {
    const prev = historyRef.current.pop()
    if (prev === undefined) return
    setCanUndo(historyRef.current.length > 0)
    setChanges(prev)
    saveDraft(prev)
  }

  const discard = () => {
    if (!window.confirm(`Throw away ${changes.length} unsent change${changes.length === 1 ? '' : 's'}? Jobber hasn't been changed.`)) return
    commit([])
  }

  // ── Derived: where every stop sits ────────────────────────────────────────
  const changeById = useMemo(() => new Map(changes.map(c => [c.id, c])), [changes])
  const bucketById = useMemo(() => new Map(bucket.map(s => [s.id, s])), [bucket])
  const teamList = useMemo(() => team ?? [], [team])
  const laneColor = useCallback((techId: string) => LANE_COLORS[Math.max(0, teamList.indexOf(techId)) % LANE_COLORS.length], [teamList])

  const snapOf = (s: DispatchStop): DraftChange['snapshot'] => ({
    address: s.address, title: s.title, lineItemNames: s.lineItemNames, totalPrice: s.totalPrice,
    routable: s.routable, instructions: s.instructions,
  })

  const estimate = useCallback((s: DispatchStop) => {
    if (!day) return 30
    return computeDuration(s.lineItemNames, s.title, s.kind, day.duration.method, day.duration.rules, day.duration.defaultMinutes).minutes
  }, [day])

  const filteredOut = useCallback((s: DispatchStop) => {
    if (filters.hideZero && s.kind === 'visit' && Math.abs(s.totalPrice) < 0.005) return true
    if (!matchesItemFilter(s, filters.items)) return true
    const active = settings.filter_groups.filter(g => filters.groups.includes(g.id))
    if (active.length && !active.some(g => stopMatchesGroup(s, g))) return true
    return false
  }, [filters, settings.filter_groups])

  const lockFor = useCallback((s: DispatchStop, ch: DraftChange | undefined): { startMin: number; endMin: number } | null => {
    if (ch?.newLock) return { startMin: minutesOf(ch.newLock.start), endMin: minutesOf(ch.newLock.end) }
    const l = locks[s.id]
    if (!l) return null
    const a = isoToLocal(l.window_start), b = isoToLocal(l.window_end)
    if (a.date !== date) return null
    return { startMin: a.minutes, endMin: b.date === date ? b.minutes : 24 * 60 }
  }, [locks, date])

  const placed: Placed[] = useMemo(() => {
    if (!day) return []
    const out: Placed[] = []
    const place = (s: DispatchStop, fromBucket: boolean) => {
      const ch = changeById.get(s.id)
      if (ch && changeDate(ch) !== date) return // moved to another day in the draft
      if (filters.hideDone && s.isComplete && !ch) return
      const lane = ch ? ch.toTechId : (teamList.find(t => s.techIds.includes(t)) ?? s.techIds[0] ?? '')
      let startMin: number | null = null, endMin: number | null = null
      if (ch && !ch.anytime) { startMin = minutesOf(ch.toStart); endMin = minutesOf(ch.toEnd) }
      else if (ch) { /* moved here as an anytime visit */ }
      else if (s.startAt && !s.allDay) {
        const a = isoToLocal(s.startAt)
        // A midnight start is Jobber's anytime placeholder (and the only signal
        // if the allDay field is ever unavailable) — never a real appointment.
        if (a.date === date && a.minutes > 0) {
          startMin = a.minutes
          endMin = s.endAt ? isoToLocal(s.endAt).minutes : null
          if (endMin === null || endMin <= startMin) endMin = startMin + estimate(s)
        }
      }
      const lock = lockFor(s, ch)
      out.push({
        stop: s, lane, startMin, endMin,
        durationMin: startMin !== null && endMin !== null ? endMin - startMin : estimate(s),
        changed: !!ch, fromBucket, lock,
        color: stopColor(s, settings.color_rules, !!lock, resolvePinColors(s.lineItemNames, pinSettings).baseColor),
        addons: resolvePinColors(s.lineItemNames, pinSettings).auxColors.slice(0, 3),
        dim: filteredOut(s),
      })
    }
    for (const s of day.stops) place(s, false)
    for (const c of changes) {
      if (changeDate(c) !== date || day.stops.some(s => s.id === c.id)) continue
      const b = bucketById.get(c.id)
      // A bucket card scheduled in the draft, or a stop moved here from another
      // day in Month/Week. Rebuild it from the change's snapshot when it isn't
      // in today's Jobber pull or the bucket.
      const snap = c.snapshot
      place(b ?? {
        id: c.id, kind: c.kind, clientName: c.clientName, phone: c.phone,
        address: snap?.address ?? '', routable: snap?.routable ?? false,
        title: snap?.title || c.clientName, lineItemNames: snap?.lineItemNames ?? [], totalPrice: snap?.totalPrice ?? 0,
        instructions: snap?.instructions ?? null, startAt: null, endAt: null,
        allDay: true, isComplete: false, arrivalStart: null, arrivalEnd: null, techIds: c.fromTechIds,
      }, !snap)
    }
    return out
  }, [day, changes, changeById, bucketById, teamList, date, estimate, lockFor, settings.color_rules, filteredOut, pinSettings, filters.hideDone])

  const startEndFor = useCallback((techId: string): { start: LatLng | null; end: LatLng | null } => {
    const depot = day?.depot ? { lat: day.depot.lat, lng: day.depot.lng } : null
    const t = day?.techSettings.find(x => x.jobber_user_id === techId)
    const start = t?.start_kind === 'address' && t.start_lat != null && t.start_lng != null ? { lat: t.start_lat, lng: t.start_lng } : depot
    const end = t?.end_kind === 'address' && t.end_lat != null && t.end_lng != null ? { lat: t.end_lat, lng: t.end_lng } : depot
    return { start, end }
  }, [day])

  const lanes: LaneRoute[] = useMemo(() => teamList.map(techId => {
    const mine = placed.filter(p => p.lane === techId)
    const mappable = mine.filter(p => p.stop.routable && coords[p.stop.address])
    const route = orderRoute(mappable.map(p => ({ id: p.stop.id, startMin: p.startMin, p })), orders[`${date}|${techId}`]).map(x => x.p)
    const num = new Map(route.map((p, i) => [p.stop.id, i + 1]))
    const timed = mappable.filter(p => p.startMin !== null).sort((a, b) => (a.startMin! - b.startMin!))
    const tray = mine.filter(p => !timed.includes(p))
      .sort((a, b) => (num.get(a.stop.id) ?? 999) - (num.get(b.stop.id) ?? 999))
    const { start, end } = startEndFor(techId)
    return { techId, start, end, route, num, timed, tray, legs: routes[techId] ?? null }
  }), [teamList, placed, coords, startEndFor, routes, orders, date])

  // Stops this day's draft moved to OTHER days (Month/Week drags) — listed under the lanes.
  const movedAway = useMemo(() => (day?.stops ?? []).flatMap(s => {
    const ch = changeById.get(s.id)
    return ch && changeDate(ch) !== date ? [{ stop: s, ch }] : []
  }), [day, changeById, date])

  // ── Road legs per lane ────────────────────────────────────────────────────
  const legKey = useMemo(() => lanes.map(l => {
    const pts = [l.start, ...l.route.map(p => coords[p.stop.address]), l.end]
    return `${l.techId}:${pts.map(p => p ? `${p.lat.toFixed(5)},${p.lng.toFixed(5)}` : 'x').join(';')}`
  }).join('|'), [lanes, coords])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const next: Record<string, Leg[]> = {}
      await Promise.all(lanes.map(async l => {
        const pts: LatLng[] = []
        if (l.start) pts.push(l.start)
        for (const p of l.route) { const c = coords[p.stop.address]; if (c) pts.push(c) }
        if (l.end && l.route.length) pts.push(l.end)
        if (pts.length < 2) { next[l.techId] = []; return }
        const legs: Leg[] = []
        for (let i = 0; i < pts.length - 1; i++) legs.push(await fetchLeg(pts[i], pts[i + 1]))
        next[l.techId] = legs
      }))
      if (!cancelled) setRoutes(next)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legKey])

  // ── Moves ─────────────────────────────────────────────────────────────────
  const findStop = useCallback((id: string): { stop: DispatchStop; fromBucket: boolean } | null => {
    const s = day?.stops.find(x => x.id === id)
    if (s) return { stop: s, fromBucket: false }
    const p = placed.find(x => x.stop.id === id)
    if (p) return { stop: p.stop, fromBucket: p.fromBucket }
    const b = bucketById.get(id)
    return b ? { stop: b, fromBucket: true } : null
  }, [day, placed, bucketById])

  const applyMove = useCallback((stopId: string, lane: string, rawStart: number, opts: { overrideWindow?: boolean; exact?: boolean } = {}) => {
    const found = findStop(stopId)
    if (!found) return
    const { stop } = found
    if (stop.isComplete) { setNotice('That stop is already completed in Jobber.'); return }
    const startMin = Math.max(0, Math.min(24 * 60 - SNAP, opts.exact ? Math.round(rawStart) : Math.round(rawStart / SNAP) * SNAP))
    const p = placed.find(x => x.stop.id === stopId)
    const duration = p?.durationMin ?? estimate(stop)
    const existing = changeById.get(stopId)
    const lock = p?.lock ?? lockFor(stop, existing)

    let newLock = existing?.newLock ?? null
    if (lock && (startMin < lock.startMin || startMin >= lock.endMin)) {
      if (!opts.overrideWindow) { setWindowPrompt({ stopId, lane, startMin, lock }); return }
      // "Move anyway — customer agreed": the promise moves with the stop.
      const delta = startMin - (p?.startMin ?? lock.startMin)
      const len = lock.endMin - lock.startMin
      const ns = p?.startMin != null ? lock.startMin + delta : startMin
      newLock = { start: localStamp(date, ns), end: localStamp(date, ns + len) }
    }

    const arrivalFirst = hhmmToMinutes(settings.arrival_first), arrivalLast = hhmmToMinutes(settings.arrival_last)
    if (startMin < arrivalFirst || startMin > arrivalLast) {
      setNotice(`Heads up: ${fmtClock(startMin)} is outside the arrival hours (${fmtClock(arrivalFirst)} – ${fmtClock(arrivalLast)}). It's in the draft anyway.`)
    } else setNotice(null)

    const change: DraftChange = {
      id: stop.id,
      kind: stop.kind,
      clientName: stop.clientName,
      phone: stop.phone,
      fromStartAt: existing ? existing.fromStartAt : stop.startAt,
      fromTechIds: existing ? existing.fromTechIds : stop.techIds,
      toStart: localStamp(date, startMin),
      toEnd: localStamp(date, startMin + Math.max(SNAP, duration)),
      toTechId: lane,
      newLock,
      at: new Date().toISOString(),
      snapshot: snapOf(stop),
    }
    // Dropped exactly back where Jobber has it → no change at all.
    const backHome = !stop.allDay && stop.startAt && isoToLocal(stop.startAt).date === date
      && isoToLocal(stop.startAt).minutes === startMin && stop.techIds.includes(lane) && !newLock
    const rest = changes.filter(c => c.id !== stopId)
    commit(backHome ? rest : [...rest, change])
  }, [findStop, placed, estimate, changeById, lockFor, date, settings.arrival_first, settings.arrival_last, changes, commit])

  // ── Length: drag a box's right edge, or set it in the stop panel ─────────
  // Ben, Oct 2026: the length from settings must be overridable by hand. The
  // new end goes into the draft like any move; Jobber gets it on Send, and
  // later moves / Optimize keep the new length.
  const applyLength = useCallback((stopId: string, rawEnd: number) => {
    const p = placed.find(x => x.stop.id === stopId)
    if (!p || p.startMin == null) return
    const stop = p.stop
    if (stop.isComplete) { setNotice('That stop is already completed in Jobber.'); return }
    const endMin = Math.min(24 * 60 - 1, Math.max(p.startMin + 10, Math.round(rawEnd / 5) * 5))
    const existing = changeById.get(stopId)
    const change: DraftChange = {
      id: stop.id, kind: stop.kind, clientName: stop.clientName, phone: stop.phone,
      fromStartAt: existing ? existing.fromStartAt : stop.startAt,
      fromTechIds: existing ? existing.fromTechIds : stop.techIds,
      toStart: localStamp(date, p.startMin),
      toEnd: localStamp(date, endMin),
      toTechId: p.lane,
      newLock: existing?.newLock ?? null,
      at: new Date().toISOString(),
      snapshot: snapOf(stop),
    }
    // Back to exactly what Jobber has → no change at all.
    const js = stop.startAt && !stop.allDay ? isoToLocal(stop.startAt) : null
    const je = stop.endAt ? isoToLocal(stop.endAt) : null
    const backHome = js && je && js.date === date && js.minutes === p.startMin && je.minutes === endMin
      && stop.techIds.includes(p.lane) && !change.newLock
    const rest = changes.filter(c => c.id !== stopId)
    commit(backHome ? rest : [...rest, change])
  }, [placed, changeById, date, changes, commit])

  const applyLengthRef = useRef(applyLength)
  useEffect(() => { applyLengthRef.current = applyLength }, [applyLength])
  const resizingRef = useRef(false)
  const [resize, setResize] = useState<null | { id: string; startMin: number; endMin: number }>(null)

  const startResize = (e: React.PointerEvent<HTMLDivElement>, p: Placed) => {
    if (p.startMin == null || p.endMin == null) return
    e.preventDefault(); e.stopPropagation()
    const laneW = e.currentTarget.parentElement?.parentElement?.getBoundingClientRect().width ?? 1
    const startX = e.clientX
    const origEnd = p.startMin + p.durationMin
    const startMin = p.startMin
    resizingRef.current = true
    setResize({ id: p.stop.id, startMin, endMin: origEnd })
    let last = origEnd
    const onMove = (ev: PointerEvent) => {
      last = Math.max(startMin + 10, Math.round((origEnd + ((ev.clientX - startX) / laneW) * span) / 5) * 5)
      setResize({ id: p.stop.id, startMin, endMin: last })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setResize(null)
      if (last !== origEnd) applyLengthRef.current(p.stop.id, last)
      // Let the click that ends the drag pass before re-enabling drag-to-move.
      window.setTimeout(() => { resizingRef.current = false }, 0)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ── Month/Week drags: move a stop to another day / tech (into the draft) ──
  // An anytime stop moves as anytime (date + tech only); a timed one keeps its
  // clock time. A promised time frame moves with it to the new day.
  const moveFromCalendar = useCallback((s: RangeStop, fromDate: string | null, toDate: string, toTechId: string) => {
    if (s.isComplete) { setNotice('That stop is already completed in Jobber.'); return }
    const existing = changeById.get(s.id)
    const anytime = s.startMin == null
    const hhmmL = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`
    let newLock = existing?.newLock ?? null
    if (s.lock && fromDate && fromDate !== toDate) {
      const a = isoToLocal(s.lock.start), b = isoToLocal(s.lock.end)
      newLock = { start: `${toDate}T${hhmmL(a.minutes)}`, end: `${toDate}T${hhmmL(b.minutes)}` }
    }
    const end = s.endMin ?? (s.startMin != null ? s.startMin + 30 : 0)
    const change: DraftChange = {
      id: s.id, kind: s.kind, clientName: s.clientName, phone: s.phone,
      fromStartAt: existing ? existing.fromStartAt : s.startAt,
      fromTechIds: existing ? existing.fromTechIds : s.techIds,
      toStart: anytime ? `${toDate}T00:00:00` : localStamp(toDate, s.startMin!),
      toEnd: anytime ? `${toDate}T00:00:00` : localStamp(toDate, end),
      toTechId, anytime, newLock,
      at: new Date().toISOString(),
      snapshot: snapOf(s),
    }
    // Dragged back to where Jobber has it → no change at all.
    const orig = existing ? { startAt: existing.fromStartAt, techIds: existing.fromTechIds } : { startAt: s.startAt, techIds: s.techIds }
    const o = orig.startAt ? isoToLocal(orig.startAt) : null
    const backHome = !!o && o.date === toDate && orig.techIds.includes(toTechId) && !change.newLock
      && (anytime ? o.minutes === 0 || existing?.anytime === true : o.minutes === s.startMin)
    commit([...changes.filter(c => c.id !== s.id), ...(backHome ? [] : [change])])
  }, [changeById, changes, commit])

  // ── Week/Month customer box: retime, length (Ben, Oct 22 2026) ────────────
  // The draft already spans days, so a time set from Month is the same kind of
  // change Day view makes. What Month can't show is the timeline, so instead of
  // the drive picture it warns about a clash with the tech's other stops.
  const calSel = useMemo(() => {
    if (!calSelId) return null
    for (const [d, list] of Object.entries(calDays)) { const s = list.find(x => x.id === calSelId); if (s) return { s, day: d } }
    return null
  }, [calDays, calSelId])
  const calLockOf = useCallback((s: EffStop): { startMin: number; endMin: number } | null => {
    const ch = changeById.get(s.id)
    const l = ch?.newLock ?? s.lock
    return l ? { startMin: isoToLocal(l.start).minutes, endMin: isoToLocal(l.end).minutes } : null
  }, [changeById])
  const calClash = useCallback((s: EffStop, d: string, lane: string, startMin: number, endMin: number): string | null => {
    const other = (calDays[d] ?? []).find(x => x.id !== s.id && x.techIds.includes(lane) && x.startMin != null
      && startMin < (x.endMin ?? x.startMin + 30) && x.startMin < endMin)
    return other ? `overlaps ${other.clientName} (${fmtClock(other.startMin!)}) for ${userName(lane)}` : null
  }, [calDays, userName])
  const retimeFromCalendar = useCallback((s: EffStop, d: string, lane: string, rawStart: number, lengthMin?: number) => {
    if (s.isComplete) { setNotice('That stop is already completed in Jobber.'); return }
    const startMin = Math.max(0, Math.min(24 * 60 - SNAP, Math.round(rawStart / 5) * 5))
    const duration = lengthMin ?? (s.startMin != null && s.endMin != null && s.endMin > s.startMin ? s.endMin - s.startMin : estimate(s))
    const existing = changeById.get(s.id)
    const lock = calLockOf(s)
    let newLock = existing?.newLock ?? null
    if (lock && (startMin < lock.startMin || startMin >= lock.endMin)) {
      if (!window.confirm(`${s.clientName} was promised ${fmtClock(lock.startMin)} – ${fmtClock(lock.endMin)}. ${fmtClock(startMin)} is outside it.\n\nMove anyway (the customer agreed)? The promised time frame moves with the stop.`)) return
      const len = lock.endMin - lock.startMin
      const ns = s.startMin != null ? lock.startMin + (startMin - s.startMin) : startMin
      newLock = { start: localStamp(d, ns), end: localStamp(d, ns + len) }
    }
    const warnings: string[] = []
    const arrivalFirst = hhmmToMinutes(settings.arrival_first), arrivalLast = hhmmToMinutes(settings.arrival_last)
    if (startMin < arrivalFirst || startMin > arrivalLast) warnings.push(`${fmtClock(startMin)} is outside the arrival hours (${fmtClock(arrivalFirst)} – ${fmtClock(arrivalLast)})`)
    const clash = calClash(s, d, lane, startMin, startMin + duration)
    if (clash) warnings.push(clash)
    setNotice(warnings.length ? `Heads up: ${warnings.join('; ')}. It's in the draft anyway — open the day to see the drive.` : null)
    const change: DraftChange = {
      id: s.id, kind: s.kind, clientName: s.clientName, phone: s.phone,
      fromStartAt: existing ? existing.fromStartAt : s.startAt,
      fromTechIds: existing ? existing.fromTechIds : s.techIds,
      toStart: localStamp(d, startMin),
      toEnd: localStamp(d, startMin + Math.max(10, duration)),
      toTechId: lane,
      newLock,
      at: new Date().toISOString(),
      snapshot: snapOf(s),
    }
    // Back to exactly what Jobber has → no change at all.
    const js = s.startAt && !s.allDay ? isoToLocal(s.startAt) : null
    const je = s.endAt ? isoToLocal(s.endAt) : null
    const fromTechs = existing ? existing.fromTechIds : s.techIds
    const backHome = !!js && js.date === d && js.minutes === startMin && fromTechs.includes(lane) && !newLock
      && (!je || je.minutes === startMin + Math.max(10, duration))
    commit([...changes.filter(c => c.id !== s.id), ...(backHome ? [] : [change])])
  }, [changeById, calLockOf, calClash, estimate, settings.arrival_first, settings.arrival_last, changes, commit])

  // ── Optimize day (preview first; Apply puts it in the draft) ─────────────
  /**
   * Optimize one day — Day view or a 🗺 day in Week/Month. `ctx` describes every
   * stop on the day (route order per tech in `routeIds`); `req` says which to
   * optimize and any 📌 pins. Shows a preview; nothing changes until Apply.
   */
  const optimizeDay = async (
    d: string,
    req: OptimizeRequest,
    ctx: Record<string, OptCtxStop>,
    routeIds: Record<string, string[]>,
    ends: Record<string, { start: LatLng | null; end: LatLng | null }>,
  ) => {
    setOptimizing(true); setNotice(null)
    try {
      const payload = req.lanes.map(l => ({
        techId: l.techId,
        start: ends[l.techId]?.start ?? null, end: ends[l.techId]?.end ?? null,
        firstId: l.firstId, lastId: l.lastId,
        stops: l.stopIds.map(id => ctx[id]).filter(c => c && c.lat != null).map(c => ({
          id: c.stop.id, lat: c.lat!, lng: c.lng!,
          durationMin: c.durationMin ?? null,
          window: c.lock ? [c.lock.startMin, c.lock.endMin] as [number, number] : null,
          currentStart: c.startMin,
          kind: c.stop.kind, title: c.stop.title, lineItemNames: c.stop.lineItemNames,
        })),
      })).filter(l => l.stops.length > 0)
      if (payload.length === 0) { setNotice('No stops with an address to optimize.'); return }
      const res = await fetch('/api/hub/routing/dispatch/optimize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: d, lanes: payload, notBefore: d === todayLocal() ? isoToLocal(new Date().toISOString()).minutes : null }),
      })
      const r = await res.json()
      if (!res.ok) throw new Error(r.error || 'Optimize failed')
      setOptPreview({ date: d, results: r.results ?? [], ctx, routeIds })
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Optimize failed')
    } finally {
      setOptimizing(false)
    }
  }

  /** Day view: the panel's request → the day's context. */
  const runOptimize = (req: OptimizeRequest) => {
    const ctx: Record<string, OptCtxStop> = {}
    const routeIds: Record<string, string[]> = {}
    const ends: Record<string, { start: LatLng | null; end: LatLng | null }> = {}
    for (const l of lanes) {
      routeIds[l.techId] = l.route.map(p => p.stop.id)
      ends[l.techId] = { start: l.start, end: l.end }
      for (const p of [...l.route, ...l.tray]) {
        const c = coords[p.stop.address]
        ctx[p.stop.id] = { stop: p.stop, startMin: p.startMin, durationMin: p.durationMin, lock: p.lock, lane: l.techId, lat: c?.lat ?? null, lng: c?.lng ?? null }
      }
    }
    void optimizeDay(date, req, ctx, routeIds, ends)
  }

  /** Week/Month: the 🗺 day's panel. Start/end = the tech's own setting, else the shop. */
  const optimizeFromCalendar = (d: string, req: OptimizeRequest, ctx: Record<string, OptCtxStop>, routeIds: Record<string, string[]>, depot: LatLng | null) => {
    const ends: Record<string, { start: LatLng | null; end: LatLng | null }> = {}
    for (const t of Object.keys(routeIds)) {
      const ts = baseTechSettings.find(x => x.jobber_user_id === t)
      ends[t] = {
        start: ts?.start_kind === 'address' && ts.start_lat != null && ts.start_lng != null ? { lat: ts.start_lat, lng: ts.start_lng } : depot,
        end: ts?.end_kind === 'address' && ts.end_lat != null && ts.end_lng != null ? { lat: ts.end_lat, lng: ts.end_lng } : depot,
      }
    }
    void optimizeDay(d, req, ctx, routeIds, ends)
  }

  const applyOptimize = () => {
    if (!optPreview) return
    const d = optPreview.date
    let next = [...changes]
    const byId = new Map(next.map(c => [c.id, c]))
    for (const r of optPreview.results) {
      if (!r.starts || !r.order) continue
      for (const [id, startMin] of Object.entries(r.starts)) {
        const c = optPreview.ctx[id]
        if (!c) continue
        // Anytime stops stay anytime in Jobber (Ben, Oct 20 2026) — Optimize only
        // sets their ORDER (saved below, in Hub). Timed stops get the new times.
        if (c.startMin == null) continue
        if (c.startMin === startMin && c.lane === r.techId) continue
        const existing = byId.get(id)
        const stop = c.stop
        const dur = c.durationMin ?? 30
        const ch: DraftChange = {
          id, kind: stop.kind, clientName: stop.clientName, phone: stop.phone,
          fromStartAt: existing ? existing.fromStartAt : stop.startAt,
          fromTechIds: existing ? existing.fromTechIds : stop.techIds,
          toStart: localStamp(d, startMin),
          toEnd: localStamp(d, startMin + Math.max(SNAP, dur)),
          toTechId: r.techId,
          newLock: existing?.newLock ?? null,
          at: new Date().toISOString(),
          snapshot: snapOf(stop),
        }
        const o = stop.startAt && !stop.allDay ? isoToLocal(stop.startAt) : null
        const backHome = !!o && o.date === d && o.minutes === startMin && stop.techIds.includes(r.techId) && !ch.newLock
        next = next.filter(x => x.id !== id)
        if (!backHome) next.push(ch)
      }
      // Unticked stops keep their slots; the optimized ones fill the rest in order.
      const full = optPreview.routeIds[r.techId] ?? []
      const chosen = new Set(r.order)
      const queue = [...r.order]
      const merged = full.map(id => (chosen.has(id) ? queue.shift()! : id))
      saveOrder(d, r.techId, [...merged, ...queue])
    }
    commit(next)
    setOptPreview(null)
  }

  // ── Find a slot ────────────────────────────────────────────────────────────
  const titleWindow = useCallback((s: DispatchStop) =>
    settings.title_windows ? parseTitleWindow(s.title, settings) : null, [settings])

  const runSlots = async (s: DispatchStop) => {
    setSelectedId(s.id)
    const w = locks[s.id]
      ? (() => { const a = isoToLocal(locks[s.id].window_start), b = isoToLocal(locks[s.id].window_end); return { start: a.minutes, end: b.minutes, label: 'promised' } })()
      : titleWindow(s)
    setSlots({ stopId: s.id, loading: true, options: [], window: w })
    setGhost(null)
    try {
      const res = await fetch('/api/hub/routing/dispatch/slots', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stop: { id: s.id, address: s.address, durationMin: estimate(s), window: w ? [w.start, w.end] : null },
          techIds: teamList,
          fromDate: date > todayLocal() ? date : undefined,
          days: 14,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Find a slot failed')
      setSlots({ stopId: s.id, loading: false, options: d.options ?? [], note: d.note, window: w })
    } catch (e) {
      setSlots({ stopId: s.id, loading: false, options: [], error: e instanceof Error ? e.message : 'Find a slot failed', window: w })
    }
  }

  const previewSlot = (stopId: string, o: { date: string; techId: string; startMin: number }) => {
    const s = findStop(stopId)?.stop
    setGhost({ date: o.date, lane: o.techId, startMin: o.startMin, durationMin: s ? estimate(s) : 30, stopId })
    setView('day')
    if (o.date !== date) setDate(o.date)
  }

  const scheduleSlot = (stopId: string, o: { date: string; techId: string; startMin: number }) => {
    setGhost(null)
    setSlots(null)
    setView('day')
    if (o.date === date) applyMove(stopId, o.techId, o.startMin, { exact: true })
    else { setPendingPlace({ date: o.date, stopId, lane: o.techId, startMin: o.startMin }); setDate(o.date) }
  }

  // A slot on another day: switch days, wait for that day (and its draft) to load, then place it.
  useEffect(() => {
    if (!pendingPlace || !day || day.date !== pendingPlace.date || loading) return
    const p = pendingPlace
    setPendingPlace(null)
    applyMove(p.stopId, p.lane, p.startMin, { exact: true })
  }, [pendingPlace, day, loading, applyMove])

  // Drag and drop (desktop). Touch / keyboard users move a stop from its panel.
  const dragRef = useRef<{ id: string; grabMin: number } | null>(null)
  const onDragStartStop = (e: React.DragEvent, id: string, grabMin: number) => {
    dragRef.current = { id, grabMin }
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', id) } catch {}
  }
  const onDropLane = (e: React.DragEvent<HTMLDivElement>, lane: string) => {
    e.preventDefault()
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    const rect = e.currentTarget.getBoundingClientRect()
    const min = viewStart + ((e.clientX - rect.left) / rect.width) * span - d.grabMin
    applyMove(d.id, lane, min)
  }

  // ── Locks (Hub-only, saved immediately) ───────────────────────────────────
  // `onDay` = the stop's own day (Week/Month); Day view locks on the day on screen.
  const saveLock = async (s: DispatchStop, startHHMM: string, endHHMM: string, onDay: string = date) => {
    const res = await fetch('/api/hub/routing/dispatch/locks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobberItemId: s.id, kind: s.kind,
        windowStart: localToIso(`${onDay}T${startHHMM}:00`), windowEnd: localToIso(`${onDay}T${endHHMM}:00`),
      }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setNotice(d.error || 'Could not lock the time frame'); return }
    setLocks(prev => ({ ...prev, [s.id]: d.lock }))
    if (view !== 'day') setCalTick(t => t + 1)
  }
  const removeLock = async (s: DispatchStop) => {
    const res = await fetch(`/api/hub/routing/dispatch/locks?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' })
    if (!res.ok) { setNotice('Could not unlock'); return }
    setLocks(prev => { const n = { ...prev }; delete n[s.id]; return n })
    if (view !== 'day') setCalTick(t => t + 1)
  }

  // ── Send to Jobber ────────────────────────────────────────────────────────
  // The draft spans days, so "customers were already told" is judged per change:
  // the day the visit WAS on had its reminders out, and the visit's time or day moved.
  const toldCustomer = (c: DraftChange) => {
    if (!c.fromStartAt) return false
    const was = isoToLocal(c.fromStartAt)
    if (!remindersAlreadySent(was.date, settings.reminder_cutoff)) return false
    if (c.anytime) return was.date !== changeDate(c)
    return !(was.date === changeDate(c) && was.minutes === minutesOf(c.toStart))
  }
  const remindersOut = changes.some(toldCustomer)

  const send = async () => {
    setSending(true)
    try {
      const checkRes = await fetch('/api/hub/routing/dispatch/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: changes.map(c => ({ id: c.id, kind: c.kind, fromStartAt: c.fromStartAt, fromTechIds: c.fromTechIds })) }),
      })
      const check = await checkRes.json()
      if (!checkRes.ok) throw new Error(check.error || 'Could not check Jobber before sending')
      const conflictMap = new Map<string, string>((check.conflicts ?? []).map((c: { id: string; reason: string }) => [c.id, c.reason]))
      const toSend = changes.filter(c => !conflictMap.has(c.id))

      const ok: Array<{ change: DraftChange; remind: boolean }> = []
      const failed: Array<{ change: DraftChange; error: string }> = []

      // Anytime moves (Month/Week drags of anytime stops) go through the
      // optimizer's "day + tech" writer, which keeps them Anytime in Jobber.
      // It moves every item in a call to one day and (optionally) one tech.
      const anyGroups = new Map<string, DraftChange[]>()
      for (const c of toSend.filter(x => x.anytime)) {
        const k = `${changeDate(c)}|${c.fromTechIds.includes(c.toTechId) ? '__keep__' : c.toTechId}`
        anyGroups.set(k, [...(anyGroups.get(k) ?? []), c])
      }
      for (const [k, list] of anyGroups) {
        const [d, tech] = k.split('|')
        const res = await fetch('/api/reorder-jobber', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            visit_ids: list.map(c => c.id), visit_types: list.map(c => c.kind),
            assigned_date: d, ...(tech !== '__keep__' ? { assigned_user_id: tech } : {}),
          }),
        })
        const r = await res.json().catch(() => ({}))
        if (!res.ok) { for (const c of list) failed.push({ change: c, error: r.error || `Jobber send failed (${res.status})` }); continue }
        const byId = new Map<string, { success: boolean; error?: string }>((r.results ?? []).map((x: { visitId: string; success: boolean; error?: string }) => [x.visitId, x]))
        for (const c of list) {
          const x = byId.get(c.id)
          if (x?.success) ok.push({ change: c, remind: toldCustomer(c) })
          else failed.push({ change: c, error: x?.error ?? 'No result from Jobber' })
        }
      }

      // /api/send-to-jobber reassigns every item in a call to one tech, so group
      // by "reassign to X" vs "keep who's on it".
      const groups = new Map<string, DraftChange[]>()
      for (const c of toSend.filter(x => !x.anytime)) {
        const k = c.fromTechIds.includes(c.toTechId) ? '__keep__' : c.toTechId
        groups.set(k, [...(groups.get(k) ?? []), c])
      }
      for (const [k, list] of groups) {
        const res = await fetch('/api/send-to-jobber', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            visits: list.map(c => ({ visitId: c.id, startAt: c.toStart, endAt: c.toEnd, type: c.kind })),
            assignedUserId: k === '__keep__' ? null : k,
          }),
        })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) { for (const c of list) failed.push({ change: c, error: d.error || `Jobber send failed (${res.status})` }); continue }
        const byId = new Map<string, { success: boolean; error?: string }>((d.results ?? []).map((r: { visitId: string; success: boolean; error?: string }) => [r.visitId, r]))
        for (const c of list) {
          const r = byId.get(c.id)
          if (r?.success) ok.push({ change: c, remind: toldCustomer(c) })
          else failed.push({ change: c, error: r?.error ?? 'No result from Jobber' })
        }
      }

      // A promise that moved with the stop ("customer agreed") is saved once Jobber has the move.
      for (const { change } of ok) {
        if (!change.newLock) continue
        await fetch('/api/hub/routing/dispatch/locks', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobberItemId: change.id, kind: change.kind, windowStart: localToIso(change.newLock.start), windowEnd: localToIso(change.newLock.end) }),
        }).catch(() => {})
      }

      const sentIds = new Set(ok.map(o => o.change.id))
      const remaining = changes.filter(c => !sentIds.has(c.id))
      historyRef.current = []
      setCanUndo(false)
      setChanges(remaining)
      await fetch('/api/hub/routing/dispatch/draft', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes: remaining }),
      }).catch(() => {})

      setSendReport({
        ok, failed,
        conflicts: changes.filter(c => conflictMap.has(c.id)).map(c => ({ change: c, reason: conflictMap.get(c.id)! })),
        unchecked: (check.unchecked ?? []).length,
      })
      setSendOpen(false)
      setCalTick(t => t + 1)
      await Promise.all([view === 'day' ? loadDay() : Promise.resolve(), loadBucket(true), loadDraft()])
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const textNewTime = async (c: DraftChange) => {
    if (!c.phone) return
    const first = c.clientName.split(' ')[0] || 'there'
    const dayLabel = new Date(`${c.toStart.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
    const body = c.anytime
      ? `Hi ${first}, a quick update on your service visit: it's now scheduled for ${dayLabel}. Reply here if that doesn't work for you.`
      : `Hi ${first}, a quick update on your service visit: we now plan to arrive ${dayLabel} around ${fmtClock(minutesOf(c.toStart))}. Reply here if that doesn't work for you.`
    try {
      const res = await fetch('/api/txt/conversations/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: c.phone, name: c.clientName }),
      })
      const d = await res.json()
      if (!res.ok || !d.conversation_id) throw new Error()
      try { sessionStorage.setItem(`lynxedo-txt-prefill:${d.conversation_id}`, body) } catch {}
      router.push(`/hub/txt/${d.conversation_id}`)
    } catch {
      setNotice("Couldn't open a text thread for that customer.")
    }
  }

  // ── Day-before reminders (preview only here; built OFF) ───────────────────
  const remDate = date > todayLocal() ? date : addDays(todayLocal(), 1)
  const openReminders = async () => {
    setRemOpen(true)
    setRem({ loading: true })
    try {
      const res = await fetch(`/api/hub/routing/dispatch/reminders/preview?date=${remDate}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not load the preview')
      setRem({ loading: false, ...d })
    } catch (e) {
      setRem({ loading: false, error: e instanceof Error ? e.message : 'Could not load the preview' })
    }
  }
  const sendSample = async (itemId: string) => {
    setRemSample(m => ({ ...m, [itemId]: 'Sending…' }))
    const res = await fetch('/api/hub/routing/dispatch/reminders/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, date: rem?.date ?? remDate }),
    })
    const d = await res.json().catch(() => ({}))
    setRemSample(m => ({ ...m, [itemId]: res.ok ? (d.results ?? []).join(' ') : (d.error || 'Failed') }))
  }

  // ── Route sheet → the tech's Work Orders (Daily Log) ─────────────────────
  // The stops themselves reach the Work Order list on their own (it's fed from
  // Jobber); what the office also wants there is the printed PDF route sheet.
  // Same path as the Advanced optimizer's "Send to Daily Log": the sheet HTML is
  // built here and /api/hub/daily-log/from-route renders the PDF and attaches it.
  const laneHasUnsent = (techId: string) => changes.some(c => c.toTechId === techId || c.fromTechIds.includes(techId))

  const sendSheet = async (l: LaneRoute) => {
    const techName = userName(l.techId)
    if (laneHasUnsent(l.techId)) {
      setSheetMsg(m => ({ ...m, [l.techId]: { ok: false, text: 'Send to Jobber first — the sheet should match Jobber.' } }))
      return
    }
    const legs = l.legs ?? []
    const offset = l.start ? 1 : 0
    // Stops not on the map (no address, or the address couldn't be found) print first, unnumbered.
    const unroutable = l.tray.filter(p => !l.num.has(p.stop.id))
    if (l.route.length === 0 && unroutable.length === 0) {
      setSheetMsg(m => ({ ...m, [l.techId]: { ok: false, text: 'No stops to print.' } }))
      return
    }
    setSheetMsg(m => ({ ...m, [l.techId]: { busy: true, text: 'Building the route sheet…' } }))
    const items = (p: Placed) => p.stop.lineItems ?? p.stop.lineItemNames.map(n => ({ name: n, qty: 1, unitPrice: 0, totalPrice: 0 }))
    const sheetStops: RouteSheetStop[] = [
      ...unroutable.map(p => ({
        stopNumber: 0, routable: false, clientName: p.stop.clientName, addressString: p.stop.address, phone: p.stop.phone,
        jobTitle: p.stop.title, eta: '', driveMinutes: 0, onSiteMinutes: p.durationMin, distanceKm: 0, lat: 0, lng: 0,
        lineItems: items(p), services: p.stop.lineItemNames.join(', '), totalPrice: p.stop.totalPrice, instructions: p.stop.instructions,
      })),
      ...l.route.map((p, i) => {
        const c = coords[p.stop.address]!
        const leg = i > 0 || l.start ? legs[i - 1 + offset] : undefined
        return {
          stopNumber: i + 1, routable: true, clientName: p.stop.clientName, addressString: p.stop.address, phone: p.stop.phone,
          jobTitle: p.stop.title, eta: p.startMin != null ? fmtClock(p.startMin) : 'Anytime', driveMinutes: leg?.minutes ?? 0, onSiteMinutes: p.durationMin,
          distanceKm: leg ? Math.round(leg.miles * 1.609 * 10) / 10 : 0, lat: c.lat, lng: c.lng,
          lineItems: items(p), services: p.stop.lineItemNames.join(', '), totalPrice: p.stop.totalPrice, instructions: p.stop.instructions,
        }
      }),
    ]
    try {
      const html = await buildAdvancedRouteSheetHtml({
        techName, date, stops: sheetStops, depot: l.start, mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '',
      })
      const all = [...unroutable, ...l.route]
      const res = await fetch('/api/hub/daily-log/from-route', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          log_date: date,
          tech_jobber_user_id: l.techId,
          tech_jobber_user_name: techName,
          stops: all.map(p => {
            const c = coords[p.stop.address]
            return {
              jobber_visit_id: p.stop.id,
              client_name: p.stop.clientName,
              client_phone: p.stop.phone,
              address: p.stop.address,
              lat: c?.lat ?? null, lng: c?.lng ?? null,
              job_title: p.stop.title,
              line_items: items(p),
              instructions: p.stop.instructions,
              scheduled_start_at: p.startMin != null ? localToIso(localStamp(date, p.startMin)) : null,
              scheduled_end_at: p.endMin != null ? localToIso(localStamp(date, p.endMin)) : null,
              duration_minutes: p.durationMin,
            }
          }),
          tank_overrides: await fetch(`/api/hub/routing/tank-assignments?route_code=${encodeURIComponent(tankRouteCode(l.techId))}&run_date=${date}`)
            .then(r => r.json()).then(d => (d.assignments ?? null) as Record<string, number> | null).catch(() => null),
          predicted_drive_minutes: legs.reduce((sum, g) => sum + g.minutes, 0),
          predicted_onsite_minutes: all.reduce((sum, p) => sum + p.durationMin, 0),
          route_html: html || null,
          route_name: `${techName} - ${date}.html`,
        }),
      })
      const d = await res.json().catch(() => ({})) as { stop_count?: number; action?: string; error?: string }
      if (!res.ok || d.error) throw new Error(d.error || `Failed (${res.status})`)
      setSheetMsg(m => ({ ...m, [l.techId]: { ok: true, text: `Route sheet on ${techName}'s Work Orders ✓` } }))
    } catch (e) {
      setSheetMsg(m => ({ ...m, [l.techId]: { ok: false, text: e instanceof Error ? e.message : 'Could not send the route sheet' } }))
    }
  }

  // ── Bucket view ───────────────────────────────────────────────────────────
  const dayCentroids = useMemo(() => placed.map(p => coords[p.stop.address]).filter((c): c is LatLng => !!c), [placed, coords])
  const bucketShown = useMemo(() => {
    const q = bucketSearch.trim().toLowerCase()
    const list = bucket.filter(s => {
      if (changeById.has(s.id)) return false
      if (filteredOut(s)) return false
      if (bucketTeamOnly && teamList.length && !s.techIds.some(t => teamList.includes(t))) return false
      if (q && !`${s.clientName} ${s.address} ${s.title} ${s.lineItemNames.join(' ')}`.toLowerCase().includes(q)) return false
      return true
    })
    const near = (s: DispatchStop) => {
      const c = coords[s.address]
      if (!c || dayCentroids.length === 0) return Infinity
      return Math.min(...dayCentroids.map(d => haversineMi(c, d)))
    }
    if (bucketSort === 'value') list.sort((a, b) => b.totalPrice - a.totalPrice)
    else if (bucketSort === 'nearest') list.sort((a, b) => near(a) - near(b))
    else list.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
    return list.map(s => ({ s, miles: near(s) }))
  }, [bucket, changeById, filteredOut, bucketTeamOnly, teamList, bucketSearch, bucketSort, coords, dayCentroids])

  // ── Map data ──────────────────────────────────────────────────────────────
  const mapStops: DispatchMapStop[] = useMemo(() => {
    const out: DispatchMapStop[] = []
    for (const l of lanes) {
      // Every mapped stop in ROUTE order — anytime ones included (Ben, Oct 20 2026).
      l.route.forEach((p, i) => {
        const c = coords[p.stop.address]!
        const days = lastDays[p.stop.id]
        out.push({
          id: p.stop.id, lat: c.lat, lng: c.lng,
          label: pinNumbers === 'last' ? (days != null ? String(days) : '–') : String(i + 1),
          color: laneColor(l.techId),
          fill: p.dim ? '#94a3b8' : p.color, locked: !!p.lock, title: p.stop.clientName, subtitle: p.stop.address,
          meta: `${userName(l.techId)} · ${p.startMin != null ? fmtClock(p.startMin) : 'anytime'}${p.lock ? ` · promised ${fmtClock(p.lock.startMin)}–${fmtClock(p.lock.endMin)}` : ''}`,
          halo: p.addons,
          faded: (tickOff[date] ?? readPanelOff(date)).includes(p.stop.id),
        })
      })
    }
    return out
  }, [lanes, coords, laneColor, userName, tickOff, date, lastDays, pinNumbers])

  const mapLegs: DispatchMapLeg[] = useMemo(() => {
    const out: DispatchMapLeg[] = []
    for (const l of lanes) {
      if (!l.legs) continue
      const names = [l.start ? 'Shop' : null, ...l.route.map((p, i) => `${i + 1}. ${p.stop.clientName}`), 'Shop'].filter((x): x is string => !!x)
      l.legs.forEach((leg, i) => {
        const isReturn = i === l.legs!.length - 1 && !!l.end && l.route.length > 0
        out.push({
          coords: leg.coords, color: laneColor(l.techId), isReturn,
          label: isReturn ? `back to shop · ${leg.minutes} min` : '',
          tooltip: `${names[i] ?? ''} → ${names[i + 1] ?? ''} · ${leg.minutes} min · ${leg.miles} mi${leg.estimated ? ' (estimate)' : ''}`,
        })
      })
    }
    return out
  }, [lanes, laneColor])

  const mapUnscheduled = useMemo(() => bucketShown.slice(0, 150).flatMap(({ s }) => {
    const c = coords[s.address]
    return c ? [{ id: s.id, lat: c.lat, lng: c.lng, title: s.clientName, subtitle: s.address }] : []
  }), [bucketShown, coords])

  const depots = useMemo(() => {
    const out: Array<{ lat: number; lng: number; label: string }> = []
    if (day?.depot) out.push({ lat: day.depot.lat, lng: day.depot.lng, label: 'Shop' })
    for (const l of lanes) for (const p of [l.start, l.end]) {
      if (p && !out.some(d => d.lat === p.lat && d.lng === p.lng)) out.push({ ...p, label: `${userName(l.techId)} start/end` })
    }
    return out
  }, [day, lanes, userName])

  const selected = selectedId ? (placed.find(p => p.stop.id === selectedId) ?? null) : null
  const selectedBucket = selectedId && !selected ? bucketById.get(selectedId) ?? null : null

  // ── Render ────────────────────────────────────────────────────────────────
  const pct = (m: number) => `${((m - viewStart) / span) * 100}%`
  const width = (m: number) => `${(m / span) * 100}%`
  const hours: number[] = []
  for (let h = Math.ceil(viewStart / 60) * 60; h <= viewEnd; h += 60) hours.push(h)
  const nowMin = date === todayLocal() ? isoToLocal(new Date().toISOString()).minutes : null
  const arrivalFirst = hhmmToMinutes(settings.arrival_first), arrivalLast = hhmmToMinutes(settings.arrival_last)

  const toggleTeam = (id: string) => {
    const next = teamList.includes(id) ? teamList.filter(x => x !== id) : [...teamList, id]
    setTeam(next); writeLS(LS_TEAM, next)
  }
  const setFilter = (next: DispatchFilters) => { setFilters(next); writeLS(LS_FILTERS, next) }

  // ── Saved views ───────────────────────────────────────────────────────────
  async function loadViews() {
    try {
      const r = await fetch('/api/hub/routing/dispatch/views')
      const d = await r.json()
      if (r.ok) setViews(d.views ?? [])
    } catch {}
  }
  const currentConfig = (datePreset: DatePreset): DispatchViewConfig => ({
    team: teamList, view, datePreset, filters, showBucket, showTanks,
  })
  const applyView = (id: string | null) => {
    setActiveViewId(id); writeLS(LS_ACTIVE_VIEW, id)
    const v = views.find(x => x.id === id)
    if (!v) return
    const c = normalizeViewConfig(v.config)
    if (c.team.length) { setTeam(c.team); writeLS(LS_TEAM, c.team) }
    setView(c.view); writeLS(LS_VIEW, c.view)
    setFilter(c.filters)
    setShowBucket(c.showBucket); writeLS(LS_BUCKET, c.showBucket)
    setShowTanks(c.showTanks); writeLS(LS_TANKS, c.showTanks)
    setDate(d => resolveViewDate(c.datePreset, todayLocal(), d))
  }
  const saveView = async (name: string, datePreset: DatePreset, shared: boolean, overwriteId: string | null) => {
    const body = { name, config: currentConfig(datePreset), shared, ...(overwriteId ? { id: overwriteId } : {}) }
    const r = await fetch('/api/hub/routing/dispatch/views', {
      method: overwriteId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setNotice(d.error || 'Could not save the view'); return }
    await loadViews()
    setActiveViewId(d.view.id); writeLS(LS_ACTIVE_VIEW, d.view.id)
    setSaveViewOpen(false)
  }
  const deleteView = async (id: string) => {
    const v = views.find(x => x.id === id)
    if (!v || !window.confirm(`Delete the view “${v.name}”?`)) return
    const r = await fetch(`/api/hub/routing/dispatch/views?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!r.ok) { setNotice('Could not delete the view'); return }
    setActiveViewId(null); writeLS(LS_ACTIVE_VIEW, null)
    await loadViews()
  }
  const activeView = views.find(v => v.id === activeViewId) ?? null
  // Line-item options: the Jobber catalog + anything on the stops in front of us.
  const itemOptions = useMemo(() => {
    const set = new Set<string>(catalog.map(x => x.trim()).filter(Boolean))
    for (const st of day?.stops ?? []) for (const n of st.lineItemNames) if (n.trim()) set.add(n.trim())
    for (const st of bucket) for (const n of st.lineItemNames) if (n.trim()) set.add(n.trim())
    for (const n of filters.items) set.add(n)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [catalog, day, bucket, filters.items])

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <select value={activeViewId ?? ''} onChange={e => applyView(e.target.value || null)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm max-w-[14rem]" title="Saved views">
              <option value="">View…</option>
              {views.map(v => <option key={v.id} value={v.id}>{v.name}{!v.mine ? ' · shared' : v.shared ? ' · shared by you' : ''}</option>)}
            </select>
            <button type="button" onClick={() => setSaveViewOpen(true)} className="px-2.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm" title="Save the team, filters, Day/Week/Month and date as a view">💾 Save view</button>
            {activeView?.mine && (
              <button type="button" onClick={() => deleteView(activeView.id)} className="px-2 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-400" title="Delete this view">🗑</button>
            )}
          </div>
          <div className="inline-flex rounded-lg bg-gray-800 p-0.5">
            {(['day', 'week', 'month'] as const).map(v => (
              <button key={v} type="button" onClick={() => { setView(v); writeLS(LS_VIEW, v) }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium ${view === v ? 'bg-orange-500 text-[#fff]' : 'text-gray-400 hover:text-white'}`}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setDate(stepDate(date, view, -1))} className="px-2.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm" aria-label="Previous">←</button>
          <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm" />
          <button type="button" onClick={() => setDate(stepDate(date, view, 1))} className="px-2.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm" aria-label="Next">→</button>
          <button type="button" onClick={() => setDate(todayLocal())} className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">Today</button>

          <div className="relative">
            <button type="button" onClick={() => setTeamOpen(o => !o)} className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">
              👥 Team ({teamList.length})
            </button>
            {teamOpen && (
              <div className="absolute z-30 mt-1 w-64 max-h-80 overflow-auto bg-gray-900 border border-gray-700 rounded-xl shadow-xl p-2">
                {users.length === 0 && <div className="text-xs text-gray-500 p-2">Loading technicians…</div>}
                {users.map(u => (
                  <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-800 text-sm cursor-pointer">
                    <input type="checkbox" checked={teamList.includes(u.id)} onChange={() => toggleTeam(u.id)} />
                    {teamList.includes(u.id) && <span className="w-2.5 h-2.5 rounded-full" style={{ background: laneColor(u.id) }} />}
                    {u.name}
                  </label>
                ))}
                <button type="button" onClick={() => setTeamOpen(false)} className="mt-1 w-full text-xs text-gray-400 hover:text-white py-1">Done</button>
              </div>
            )}
          </div>

          <button type="button" onClick={() => { void loadDay(); void loadBucket(true) }} className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm" title="Re-read from Jobber">↻ Refresh</button>
          <button type="button" onClick={() => setShowRoutePanel(v => !v)} disabled={teamList.length === 0 || view !== 'day'}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 ${showRoutePanel && view === 'day' ? 'bg-orange-500 hover:bg-orange-400 text-[#fff]' : 'bg-gray-800 hover:bg-gray-700'}`}
            title={view === 'day' ? 'Show or hide Route & optimize (pick stops, 📌 first/last, Optimize)' : 'In Week/Month, click 🗺 on a day to optimize it'}>
            ⚡ Route &amp; optimize
          </button>
          <button type="button" onClick={openReminders} className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm" title="Preview the day-before reminder texts and emails">📨 Reminders</button>
          <button type="button" onClick={() => { const v = !showBucket; setShowBucket(v); writeLS(LS_BUCKET, v) }}
            className={`px-3 py-1.5 rounded-lg text-sm ${showBucket ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
            title={showBucket ? 'Hide the Unscheduled list for more room' : 'Show the Unscheduled list'}>
            📋 Unscheduled ({bucketShown.length}) {showBucket ? '◂' : '▸'}
          </button>
          <button type="button" onClick={() => { const v = !showTanks; setShowTanks(v); writeLS(LS_TANKS, v) }}
            className={`px-3 py-1.5 rounded-lg text-sm ${showTanks ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
            title={showTanks ? 'Hide the tank loadout' : 'Show the tank loadout (tank fill, products to mix)'}>
            🧪 Tanks
          </button>
          <DispatchLegend rules={settings.color_rules} pinSettings={pinSettings} team={teamList} userName={userName} laneColor={laneColor} />
          {loading && <span className="text-xs text-gray-500">Loading from Jobber…</span>}
        </div>

        {/* Filter chips — line items, never titles */}
        <div className="flex flex-wrap items-center gap-1.5">
          {settings.filter_groups.map(g => {
            const on = filters.groups.includes(g.id)
            return (
              <button key={g.id} type="button"
                onClick={() => setFilter({ ...filters, groups: on ? filters.groups.filter(x => x !== g.id) : [...filters.groups, g.id] })}
                className={`px-2.5 py-1 rounded-full text-xs border ${on ? 'bg-orange-500 border-orange-500 text-[#fff]' : 'border-gray-700 text-gray-300 hover:border-gray-500'}`}>
                {g.label}
              </button>
            )
          })}
          <button type="button" onClick={() => setFilter({ ...filters, hideZero: !filters.hideZero })}
            className={`px-2.5 py-1 rounded-full text-xs border ${filters.hideZero ? 'bg-orange-500 border-orange-500 text-[#fff]' : 'border-gray-700 text-gray-300 hover:border-gray-500'}`}>
            Hide $0
          </button>
          <LineItemPicker options={itemOptions} selected={filters.items} onChange={items => setFilter({ ...filters, items })} />
          <button type="button" onClick={() => setFilter({ ...filters, hideDone: !filters.hideDone })}
            title="Leave stops Jobber already shows as completed off the calendar and map"
            className={`px-2.5 py-1 rounded-full text-xs border ${filters.hideDone ? 'bg-orange-500 border-orange-500 text-[#fff]' : 'border-gray-700 text-gray-300 hover:border-gray-500'}`}>
            Hide completed
          </button>
          {(filters.groups.length > 0 || filters.items.length > 0 || filters.hideZero || filters.hideDone) && (
            <button type="button" onClick={() => setFilter({ groups: [], hideZero: false, items: [], hideDone: false })} className="text-xs text-gray-400 hover:text-white">Clear filters</button>
          )}
          {settings.filter_groups.length === 0 && <span className="text-xs text-gray-500">Filter chips are set up in Admin → Routing → Dispatch.</span>}
        </div>
      </div>

      {/* Draft bar */}
      {changes.length > 0 && (
        <div className="sticky top-0 z-20 bg-gray-900/95 backdrop-blur border border-orange-500/50 rounded-2xl px-4 py-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            {changes.length} unsent change{changes.length === 1 ? '' : 's'}
            {new Set(changes.map(changeDate)).size > 1 ? ` across ${new Set(changes.map(changeDate)).size} days` : ''}
          </span>
          {draftMeta && !draftMeta.mine && draftMeta.updatedByName && (
            <span className="text-xs text-amber-400">— started by {draftMeta.updatedByName}</span>
          )}
          <span className="text-xs text-gray-500">Nothing changes in Jobber until you send.</span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={undo} disabled={!canUndo} className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm disabled:opacity-40">↶ Undo</button>
            <button type="button" onClick={discard} disabled={changes.length === 0} className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm disabled:opacity-40">Discard</button>
            <button type="button" onClick={() => setSendOpen(true)} disabled={changes.length === 0} className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-[#fff] text-sm font-medium disabled:opacity-40">
              Send to Jobber ({changes.length})
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div className="bg-amber-900/30 border border-amber-700 text-amber-200 rounded-xl px-4 py-2 text-sm flex items-start gap-3">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-amber-400 hover:text-white" aria-label="Dismiss">✕</button>
        </div>
      )}
      {loadError && <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-xl px-4 py-2 text-sm">{loadError}</div>}
      {day?.errors.map(e => (
        <div key={e.techId} className="bg-red-900/30 border border-red-800 text-red-300 rounded-xl px-4 py-2 text-sm">
          Couldn&apos;t load {userName(e.techId)}&apos;s day from Jobber: {e.error}
        </div>
      ))}
      {day && !day.depot && (
        <div className="bg-amber-900/30 border border-amber-700 text-amber-200 rounded-xl px-4 py-2 text-sm">
          No shop address is set, so lanes have no start or end point. Set it in Admin → Routing.
        </div>
      )}

      {sendReport && (
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4 space-y-2 text-sm">
          <div className="flex items-center">
            <span className="font-semibold">Sent to Jobber: {sendReport.ok.length} ✓{sendReport.failed.length ? ` · ${sendReport.failed.length} failed` : ''}{sendReport.conflicts.length ? ` · ${sendReport.conflicts.length} held back` : ''}</span>
            <button type="button" onClick={() => setSendReport(null)} className="ml-auto text-gray-500 hover:text-white" aria-label="Close">✕</button>
          </div>
          {sendReport.conflicts.map(({ change, reason }) => (
            <div key={change.id} className="text-amber-300">
              ⚠ {change.clientName} — held back: {reason === 'moved' ? 'someone moved it in Jobber since this draft was made' : reason === 'reassigned' ? 'someone reassigned it in Jobber since' : reason === 'completed' ? "it's been completed" : "it's no longer in Jobber"}. It&apos;s still in your draft — refresh and move it again.
            </div>
          ))}
          {sendReport.failed.map(({ change, error }) => (
            <div key={change.id} className="text-red-300">✕ {change.clientName}: {error} (still in your draft)</div>
          ))}
          {sendReport.unchecked > 0 && <div className="text-xs text-gray-500">{sendReport.unchecked} assessment/task change(s) were sent without the live re-check (Jobber has no quick way to read those back).</div>}
          {sendReport.ok.some(o => o.remind) && (
            <div className="border-t border-gray-800 pt-2 space-y-1">
              <div className="text-amber-300">Jobber&apos;s reminders already went out for this day, so these customers were told the old time:</div>
              {sendReport.ok.filter(o => o.remind).map(({ change }) => (
                <div key={change.id} className="flex items-center gap-2">
                  <span className="flex-1">{change.clientName} — {describeMove(change)}</span>
                  {change.phone
                    ? <button type="button" onClick={() => textNewTime(change)} className="px-2.5 py-1 rounded-lg bg-orange-500 hover:bg-orange-400 text-[#fff] text-xs">Text new time</button>
                    : <span className="text-xs text-gray-500">no phone on file</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {team !== null && teamList.length === 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center text-gray-400">
          Pick the technicians to dispatch with <b>👥 Team</b> — each one gets a lane.
        </div>
      )}

      {/* Lanes */}
      {teamList.length > 0 && view === 'day' && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 overflow-x-auto">
          <div className="min-w-[760px]">
            {/* hour ruler */}
            <div className="flex">
              <div className="w-40 shrink-0" />
              <div className="relative flex-1 h-5 text-[10px] text-gray-500">
                {hours.map(h => <span key={h} className="absolute -translate-x-1/2" style={{ left: pct(h) }}>{fmtClock(h)}</span>)}
              </div>
            </div>
            {lanes.map(l => {
              const color = laneColor(l.techId)
              const legs = l.legs ?? []
              // Legs follow the ROUTE (anytime stops included): legs[k + offset]
              // runs route[k] → route[k+1]. Out/back only when the first/last
              // route stop has a clock time to count from.
              const offset = l.start ? 1 : 0
              const first = l.route[0], last = l.route[l.route.length - 1]
              const leave = first?.startMin != null && legs[0] && l.start ? first.startMin - legs[0].minutes : null
              const back = last?.endMin != null && l.end && legs.length === l.route.length + offset ? last.endMin + legs[legs.length - 1].minutes : null
              const miles = legs.reduce((s, g) => s + g.miles, 0)
              return (
                <div key={l.techId} className="flex border-t border-gray-800 py-2">
                  <div className="w-40 shrink-0 pr-2">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <span className="w-3 h-3 rounded-full" style={{ background: color }} />{userName(l.techId)}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      {l.timed.length} stop{l.timed.length === 1 ? '' : 's'}{miles ? ` · ${Math.round(miles)} mi` : ''}
                      {leave !== null && <> · out {fmtClock(leave)}</>}{back !== null && <> · back {fmtClock(back)}</>}
                    </div>
                    <button type="button" onClick={() => sendSheet(l)} disabled={!!sheetMsg[l.techId]?.busy || (l.route.length === 0 && l.tray.length === 0)}
                      className="mt-1 text-[11px] text-sky-400 hover:text-sky-300 disabled:opacity-40"
                      title={laneHasUnsent(l.techId) ? 'Send your changes to Jobber first' : "Attach this lane's PDF route sheet to the tech's Work Orders for the day"}>
                      📄 Send route sheet
                    </button>
                    {sheetMsg[l.techId] && (
                      <div className={`text-[10px] leading-tight ${sheetMsg[l.techId].busy ? 'text-gray-400' : sheetMsg[l.techId].ok ? 'text-green-400' : 'text-red-400'}`}>{sheetMsg[l.techId].text}</div>
                    )}
                  </div>
                  <div className="flex-1">
                    <div
                      className="relative h-16 rounded-lg bg-gray-950/60"
                      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                      onDrop={e => onDropLane(e, l.techId)}
                    >
                      {hours.map(h => <div key={h} className="absolute top-0 bottom-0 border-l border-gray-800/80" style={{ left: pct(h) }} />)}
                      {/* arrival hours */}
                      <div className="absolute top-0 bottom-0 border-l border-dashed border-emerald-700/70" style={{ left: pct(arrivalFirst) }} title={`First arrival ${fmtClock(arrivalFirst)}`} />
                      <div className="absolute top-0 bottom-0 border-l border-dashed border-emerald-700/70" style={{ left: pct(arrivalLast) }} title={`Last arrival ${fmtClock(arrivalLast)}`} />
                      {nowMin !== null && nowMin >= viewStart && nowMin <= viewEnd && (
                        <div className="absolute top-0 bottom-0 border-l-2 border-red-500 z-10" style={{ left: pct(nowMin) }} title="Now" />
                      )}
                      {leave !== null && leave >= viewStart && <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full border-2" style={{ left: pct(leave), borderColor: color }} title={`Leaves ${fmtClock(leave)}`} />}
                      {back !== null && back <= viewEnd && <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full" style={{ left: pct(back), background: color }} title={`Back ${fmtClock(back)}`} />}

                      {/* drive bars + gaps */}
                      {l.route.map((p, i) => {
                        const leg = legs[i + offset]
                        const next = l.route[i + 1]
                        // A drive bar only sits between two stops that both have times.
                        if (!leg || !next || p.endMin == null || next.startMin == null) return null
                        const driveStart = p.endMin!
                        const arrive = driveStart + leg.minutes
                        const late = arrive - next.startMin!
                        return (
                          <div key={`d-${p.stop.id}`}>
                            <div className="absolute top-[26px] h-3 rounded-sm text-[9px] leading-3 text-center overflow-hidden"
                              style={{ left: pct(driveStart), width: width(leg.minutes), background: late > 0 ? '#dc262699' : '#47556999', color: '#e2e8f0' }}
                              title={`${leg.minutes} min drive · ${leg.miles} mi${late > 0 ? ` · arrives ${late} min late` : ''}`}>
                              {leg.minutes}m
                            </div>
                            {late > 0 && <div className="absolute top-0 text-[9px] text-red-400" style={{ left: pct(next.startMin) }}>late {late}m</div>}
                            {late < -20 && (
                              <div className="absolute top-[22px] h-5 rounded-sm text-[9px] text-gray-500 flex items-center justify-center"
                                style={{ left: pct(arrive), width: width(-late), backgroundImage: 'repeating-linear-gradient(45deg,#33415555 0 4px,transparent 4px 8px)' }}>
                                {Math.round(-late)}m gap
                              </div>
                            )}
                          </div>
                        )
                      })}

                      {/* window brackets */}
                      {l.timed.filter(p => p.lock).map(p => (
                        <div key={`w-${p.stop.id}`} className="absolute bottom-0 h-1.5 border-x-2 border-b-2 border-pink-500 rounded-b"
                          style={{ left: pct(p.lock!.startMin), width: width(p.lock!.endMin - p.lock!.startMin) }}
                          title={`Promised ${fmtClock(p.lock!.startMin)} – ${fmtClock(p.lock!.endMin)}`} />
                      ))}

                      {/* Find-a-slot preview */}
                      {ghost && ghost.date === date && ghost.lane === l.techId && (
                        <div className="absolute top-1 h-[50px] rounded-md border-2 border-dashed border-emerald-400 bg-emerald-400/15 text-[10px] text-emerald-300 px-1 pointer-events-none"
                          style={{ left: pct(ghost.startMin), width: width(Math.max(SNAP, ghost.durationMin)) }}>
                          {fmtClock(ghost.startMin)}
                        </div>
                      )}

                      {/* stop blocks */}
                      {l.timed.map(p => (
                        <div key={p.stop.id}
                          draggable={!p.stop.isComplete && resize?.id !== p.stop.id}
                          onDragStart={e => {
                            if (resizingRef.current) { e.preventDefault(); return }
                            const r = e.currentTarget.getBoundingClientRect()
                            const laneW = e.currentTarget.parentElement?.getBoundingClientRect().width ?? 1
                            onDragStartStop(e, p.stop.id, ((e.clientX - r.left) / laneW) * span)
                          }}
                          onClick={() => setSelectedId(p.stop.id)}
                          className={`absolute top-1.5 h-[46px] rounded-md px-1 overflow-hidden text-[11px] leading-tight cursor-grab select-none ${p.changed ? 'ring-2 ring-orange-400 ring-dashed' : ''} ${selectedId === p.stop.id ? 'outline outline-2 outline-white' : ''}`}
                          style={{
                            left: pct(p.startMin!),
                            width: width(Math.max(SNAP, resize?.id === p.stop.id ? resize.endMin - resize.startMin : p.durationMin)),
                            background: p.color, color: '#fff', opacity: p.dim ? 0.3 : p.stop.isComplete ? 0.55 : 1,
                            borderLeft: `4px solid ${color}`,
                          }}
                          title={`${l.num.get(p.stop.id) ?? ''}. ${p.stop.clientName} · ${fmtClock(p.startMin!)}–${fmtClock(p.endMin!)}${p.lock ? ` · promised ${fmtClock(p.lock.startMin)}–${fmtClock(p.lock.endMin)}` : ''}${p.changed ? ' · moved (unsent)' : ''}`}
                        >
                          <div className="font-bold pr-1.5">{l.num.get(p.stop.id) ?? ''}{p.lock ? ' 🔒' : ''}{p.stop.isComplete ? ' ✓' : ''}
                            {lastDays[p.stop.id] != null && <span className="ml-1 font-normal text-[10px] bg-black/30 rounded px-0.5" title="Days since the last completed visit">{lastDays[p.stop.id]}d</span>}
                          </div>
                          <div className="truncate pr-1.5">{p.stop.clientName}</div>
                          <DispatchAddonStripe colors={p.addons} />
                          {resize?.id === p.stop.id && (
                            <div className="absolute bottom-0.5 right-2 text-[10px] font-semibold bg-black/50 rounded px-1">{resize.endMin - resize.startMin} min · ends {fmtClock(resize.endMin)}</div>
                          )}
                          {!p.stop.isComplete && (
                            <div
                              onPointerDown={e => startResize(e, p)}
                              onClick={e => e.stopPropagation()}
                              className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/40"
                              title="Drag to change the length"
                            />
                          )}
                        </div>
                      ))}
                    </div>

                    {/* anytime / no-address tray */}
                    {l.tray.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        <span className="text-[10px] text-gray-500 self-center">Anytime / no time set:</span>
                        {l.tray.map(p => (
                          <div key={p.stop.id} draggable={!p.stop.isComplete}
                            onDragStart={e => onDragStartStop(e, p.stop.id, 0)}
                            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                            onDrop={e => {
                              // Drop on another anytime stop in this lane = put it just before (Hub order).
                              e.preventDefault(); e.stopPropagation()
                              const d = dragRef.current
                              dragRef.current = null
                              if (!d || d.id === p.stop.id) return
                              if (!l.route.some(x => x.stop.id === d.id)) { setNotice('To move a stop to this tech, drop it on their timeline.'); return }
                              saveOrder(date, l.techId, insertInOrder(l.route.map(x => x.stop.id), d.id, p.stop.id))
                            }}
                            onClick={() => setSelectedId(p.stop.id)}
                            className={`relative overflow-hidden pl-2 pr-3 py-0.5 rounded-full text-[11px] cursor-grab text-[#fff] ${p.changed ? 'ring-2 ring-orange-400' : ''}`}
                            style={{ background: p.color, opacity: p.dim ? 0.3 : 1, borderLeft: `3px solid ${laneColor(l.techId)}` }}
                            title={p.stop.routable ? (coords[p.stop.address] === null ? "Couldn't find this address on the map" : 'Drag onto the timeline to give it a time, or onto another anytime stop to put it before that one') : 'No address'}>
                            {l.num.has(p.stop.id) ? <b>{l.num.get(p.stop.id)}. </b> : ''}{p.stop.clientName}{!p.stop.routable ? ' (no address)' : ''}
                            {lastDays[p.stop.id] != null && <span className="ml-1 text-[10px] opacity-80">{lastDays[p.stop.id]}d</span>}
                            <DispatchAddonStripe colors={p.addons} width={4} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {view === 'day' && showTanks && teamList.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
          {lanes.map(l => (
            <DispatchTankPanel key={l.techId} date={date} techId={l.techId} techName={userName(l.techId)}
              stops={[...l.route, ...l.tray].map(p => ({ id: p.stop.id, clientName: p.stop.clientName, jobTitle: p.stop.title, lineItemNames: p.stop.lineItemNames }))}
              capacity={capacity} onLoadCapacity={loadCapacity} />
          ))}
        </div>
      )}

      {view === 'day' && movedAway.length > 0 && (
        <div className="text-xs text-gray-400 flex flex-wrap gap-2 items-center">
          <span>Moved off this day (unsent):</span>
          {movedAway.map(({ stop, ch }) => (
            <span key={stop.id} className="px-2 py-0.5 rounded-full border border-orange-400/60 text-orange-300">
              {stop.clientName} → {shortDay(changeDate(ch))}{ch.anytime ? ', anytime' : `, ${fmtClock(minutesOf(ch.toStart))}`}
            </span>
          ))}
        </div>
      )}

      {/* Map + side panel */}
      {teamList.length > 0 && (
        <div className={showBucket || slots || selected || selectedBucket || (view === 'day' && showRoutePanel) || (view !== 'day' && calSel)
          ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_400px]'
          : 'grid gap-4'}>
          {view === 'day'
            ? <DispatchMap depots={depots} stops={mapStops} legs={mapLegs} unscheduled={mapUnscheduled} highlightId={selectedId} onStopClick={setSelectedId} height={MAP_HEIGHT}
                onLasso={(ids, mode) => { setShowRoutePanel(true); sendLasso(date, ids, mode) }}
                numberMode={pinNumbers} onNumberMode={m => { setPinNumbers(m); writeLS(LS_PIN_NUMBERS, m) }} />
            : <DispatchCalendar view={view} date={date} team={teamList} settings={settings} filters={filters}
                userName={userName} laneColor={laneColor} onOpenDay={d => { setDate(d); setView('day'); writeLS(LS_VIEW, 'day') }}
                changes={changes} orders={orders} onOrdersLoaded={o => setOrders(prev => ({ ...prev, ...o }))}
                onSaveOrder={saveOrder} onMoveStop={moveFromCalendar} reloadKey={calTick}
                onOptimizeDay={optimizeFromCalendar} optimizing={optimizing}
                showTanks={showTanks} capacity={capacity} onLoadCapacity={loadCapacity}
                pinSettings={pinSettings} tickOff={tickOff}
                pinNumbers={pinNumbers} onPinNumbers={m => { setPinNumbers(m); writeLS(LS_PIN_NUMBERS, m) }}
                selectedId={calSelId} onSelect={id => setCalSelId(cur => (cur === id ? null : id))} onDaysChange={setCalDays} />}

          <div className="space-y-4">
            {view !== 'day' && calSel && (() => {
              const { s, day: d } = calSel
              const lock = calLockOf(s)
              const lane = teamList.find(t => s.techIds.includes(t)) ?? s.techIds[0] ?? ''
              const dur = s.startMin != null && s.endMin != null && s.endMin > s.startMin ? s.endMin - s.startMin : estimate(s)
              return (
                <StopPanel
                  key={`${s.id}|${d}|${s.startMin ?? ''}|${dur}|${lane}|${lock?.startMin ?? ''}`}
                  stop={s}
                  placed={{ stop: s, lane, startMin: s.startMin, endMin: s.startMin != null ? s.startMin + dur : null, durationMin: dur, changed: s.changed, fromBucket: false, lock, color: '', addons: [], dim: false }}
                  team={teamList}
                  userName={userName}
                  lock={lock}
                  hasSavedLock={!!s.lock || !!locks[s.id]}
                  suggestion={titleWindow(s)}
                  dayLabel={new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}
                  onOpenDay={() => { setDate(d); setView('day'); writeLS(LS_VIEW, 'day'); setSelectedId(s.id); setCalSelId(null) }}
                  onClose={() => setCalSelId(null)}
                  onMove={(ln, hhmm) => retimeFromCalendar(s, d, ln, hhmmToMinutes(hhmm))}
                  onLock={(a, b) => saveLock(s, a, b, d)}
                  onUnlock={() => removeLock(s)}
                  onUndoMove={() => commit(changes.filter(c => c.id !== s.id))}
                  onLength={s.startMin != null ? (min: number) => retimeFromCalendar(s, d, lane, s.startMin!, min) : undefined}
                />
              )
            })()}
            {/* The customer box sits FIRST — right beside the lanes (Ben, Oct 22 2026). */}
            {(selected || selectedBucket) && (
              <StopPanel
                key={`${(selected?.stop ?? selectedBucket)!.id}|${selected?.startMin ?? ""}|${selected?.durationMin ?? ""}|${selected?.lane ?? ""}`}
                stop={(selected?.stop ?? selectedBucket)!}
                placed={selected}
                team={teamList}
                userName={userName}
                lock={selected?.lock ?? null}
                hasSavedLock={!!locks[(selected?.stop ?? selectedBucket)!.id]}
                suggestion={titleWindow((selected?.stop ?? selectedBucket)!)}
                onFindSlot={selectedBucket ? () => runSlots(selectedBucket) : undefined}
                onClose={() => setSelectedId(null)}
                onMove={(lane, hhmm) => applyMove((selected?.stop ?? selectedBucket)!.id, lane, hhmmToMinutes(hhmm))}
                onLock={(a, b) => saveLock((selected?.stop ?? selectedBucket)!, a, b)}
                onUnlock={() => removeLock((selected?.stop ?? selectedBucket)!)}
                onUndoMove={() => commit(changes.filter(c => c.id !== (selected?.stop ?? selectedBucket)!.id))}
                onLength={selected?.startMin != null ? (min: number) => applyLength(selected.stop.id, selected.startMin! + min) : undefined}
              />
            )}

            {view === 'day' && showRoutePanel && (
              <DispatchRoutePanel
                date={date}
                lanes={lanes.map((l): PanelLane => ({
                  techId: l.techId, name: userName(l.techId), color: laneColor(l.techId),
                  stops: [...l.route, ...l.tray.filter(p => !l.num.has(p.stop.id))].map(p => ({
                    id: p.stop.id, clientName: p.stop.clientName, title: p.stop.title, startMin: p.startMin,
                    mapped: l.num.has(p.stop.id), routable: p.stop.routable, locked: !!p.lock,
                    isComplete: p.stop.isComplete, changed: p.changed,
                  })),
                }))}
                busy={optimizing}
                onOptimize={runOptimize}
                onClose={() => setShowRoutePanel(false)}
              />
            )}
            {slots && (
              <div className="bg-gray-900 border border-emerald-700/60 rounded-2xl p-3 text-sm space-y-2">
                <div className="flex items-center">
                  <span className="font-semibold">Find a slot — {findStop(slots.stopId)?.stop.clientName ?? ''}</span>
                  <button type="button" onClick={() => { setSlots(null); setGhost(null) }} className="ml-auto text-gray-500 hover:text-white" aria-label="Close">✕</button>
                </div>
                <div className="text-[11px] text-gray-500">
                  Next 14 work days · {teamList.map(userName).join(', ')}{slots.window ? ` · ${slots.window.label === 'promised' ? 'promised' : `title says “${slots.window.label}”`}: ${fmtClock(slots.window.start)}–${fmtClock(slots.window.end)}` : ''}
                </div>
                {slots.loading && <div className="text-xs text-gray-400">Checking every gap…</div>}
                {slots.error && <div className="text-xs text-red-400">{slots.error}</div>}
                {slots.note && <div className="text-xs text-gray-400">{slots.note}</div>}
                {!slots.loading && !slots.error && slots.options.length === 0 && !slots.note && (
                  <div className="text-xs text-gray-400">No gap fits without pushing someone else&apos;s time. Try another team, or drag it in by hand.</div>
                )}
                {slots.options.map((o, i) => (
                  <div key={`${o.date}-${o.techId}`} className={`rounded-lg border p-2 ${ghost && ghost.date === o.date && ghost.lane === o.techId ? 'border-emerald-500' : 'border-gray-800'}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{i === 0 ? '★ ' : ''}{new Date(`${o.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} · {fmtClock(o.startMin)}</span>
                      <span className="text-xs text-gray-400">{userName(o.techId)}</span>
                      <span className="ml-auto text-xs text-emerald-400">+{o.addedMin} min drive</span>
                    </div>
                    <div className="text-[11px] text-gray-500 truncate">
                      {o.emptyDay ? 'Only stop that day (a round trip)' : o.afterAddress && o.beforeAddress ? `Between ${o.afterAddress.split(',')[0]} and ${o.beforeAddress.split(',')[0]}` : o.afterAddress ? `After ${o.afterAddress.split(',')[0]}` : o.beforeAddress ? `Before ${o.beforeAddress.split(',')[0]}` : ''}
                    </div>
                    <div className="flex gap-2 mt-1">
                      <button type="button" onClick={() => previewSlot(slots.stopId, o)} className="text-xs text-gray-300 hover:text-white">Show me</button>
                      <button type="button" onClick={() => scheduleSlot(slots.stopId, o)} className="text-xs px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-[#fff]">Schedule</button>
                    </div>
                  </div>
                ))}
                <p className="text-[10px] text-gray-600">Ranked by extra drive time; nobody else&apos;s time moves. Schedule puts it in the draft — nothing reaches Jobber until you send.</p>
              </div>
            )}

            {/* Unscheduled bucket */}
            {showBucket && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-semibold text-sm">Unscheduled</h3>
                <span className="text-xs text-gray-500">{bucketShown.length}</span>
                <button type="button" onClick={() => loadBucket(true)} className="ml-auto text-xs text-gray-400 hover:text-white" title="Re-read from Jobber">↻</button>
                <button type="button" onClick={() => { setShowBucket(false); writeLS(LS_BUCKET, false) }} className="text-xs text-gray-400 hover:text-white" title="Hide this list for more room">Hide ◂</button>
              </div>
              <div className="flex gap-1.5 mb-2">
                <input value={bucketSearch} onChange={e => setBucketSearch(e.target.value)} placeholder="Search" className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs" />
                <select value={bucketSort} onChange={e => setBucketSort(e.target.value as typeof bucketSort)} className="bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1 text-xs">
                  <option value="oldest">Oldest first</option>
                  <option value="nearest">Nearest today</option>
                  <option value="value">Highest $</option>
                </select>
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-2">
                <input type="checkbox" checked={bucketTeamOnly} onChange={e => setBucketTeamOnly(e.target.checked)} /> Only visits assigned to the team
              </label>
              {bucketLoading && <div className="text-xs text-gray-500">Loading from Jobber…</div>}
              {bucketError && <div className="text-xs text-red-400">{bucketError}</div>}
              <div className="space-y-1.5 max-h-[max(420px,calc(100vh-520px))] overflow-y-auto pr-1">
                {bucketShown.map(({ s, miles }) => {
                  const waiting = s.createdAt && bucketAt ? Math.max(0, Math.round((bucketAt - new Date(s.createdAt).getTime()) / 86400000)) : null
                  return (
                    <div key={s.id} draggable onDragStart={e => onDragStartStop(e, s.id, 0)} onClick={() => setSelectedId(s.id)}
                      className={`rounded-lg border px-2 py-1.5 cursor-grab text-xs ${selectedId === s.id ? 'border-orange-500' : 'border-gray-800 hover:border-gray-600'}`}>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: stopColor(s, settings.color_rules, false, resolvePinColors(s.lineItemNames, pinSettings).baseColor) }} />
                        <span className="font-medium truncate flex-1">{s.clientName}</span>
                        <span className="text-gray-400">{money(s.totalPrice)}</span>
                      </div>
                      <div className="text-gray-500 truncate">{s.lineItemNames[0] ?? s.title}</div>
                      <div className="text-gray-500 flex gap-2 items-center">
                        <button type="button" onClick={e => { e.stopPropagation(); void runSlots(s) }} disabled={!s.routable}
                          className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40 shrink-0">Find a slot</button>
                        {waiting !== null && <span>{waiting}d waiting</span>}
                        {Number.isFinite(miles) && <span>{miles.toFixed(1)} mi from today&apos;s stops</span>}
                        {s.techIds.length > 0 && <span className="truncate">{s.techIds.map(userName).join(', ')}</span>}
                      </div>
                    </div>
                  )
                })}
                {!bucketLoading && bucketShown.length === 0 && <div className="text-xs text-gray-500">Nothing unscheduled{bucketTeamOnly ? ' for this team' : ''}.</div>}
              </div>
              <p className="text-[10px] text-gray-600 mt-2">Drag a card onto a lane to schedule it, or use Find a slot.</p>
            </div>
            )}
          </div>
        </div>
      )}

      {saveViewOpen && (
        <SaveViewModal
          active={activeView?.mine ? activeView : null}
          onClose={() => setSaveViewOpen(false)}
          onSave={saveView}
          summary={`${teamList.length} tech${teamList.length === 1 ? '' : 's'} · ${view[0].toUpperCase()}${view.slice(1)} view · ${filters.items.length ? `${filters.items.length} line item${filters.items.length === 1 ? '' : 's'}` : 'all line items'}${filters.groups.length ? ` · ${filters.groups.length} chip${filters.groups.length === 1 ? '' : 's'}` : ''}${filters.hideZero ? ' · hide $0' : ''}${filters.hideDone ? ' · hide completed' : ''}`}
        />
      )}

      {/* Reminders preview */}
      {remOpen && rem && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setRemOpen(false)}>
          <div className="w-full max-w-3xl max-h-[85vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-2xl p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-3">
              <div className="flex-1">
                <h3 className="font-semibold">Day-before reminders — {rem.date ? new Date(`${rem.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''} visits</h3>
                {!rem.loading && !rem.error && (
                  <p className={`text-xs mt-1 ${rem.enabled ? 'text-green-400' : 'text-amber-300'}`}>
                    {rem.enabled
                      ? `Reminders are ON — these go out at ${rem.sendTime ? fmtClock(hhmmToMinutes(rem.sendTime)) : ''} the day before.`
                      : 'Reminders are OFF — nothing below will be sent. This is what would go out.'}
                    {!rem.ownerSet && ' · Pick who gets text replies in Admin → Routing → Dispatch.'}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => setRemOpen(false)} className="text-gray-500 hover:text-white" aria-label="Close">✕</button>
            </div>
            {rem.loading && <div className="text-sm text-gray-400">Reading the day from Jobber…</div>}
            {rem.error && <div className="text-sm text-red-400">{rem.error}</div>}
            {rem.items && (
              <>
                <div className="text-xs text-gray-400 mb-2">
                  {rem.items.length} visits · {rem.items.filter(i => i.sms).length} texts · {rem.items.filter(i => i.email_msg).length} emails · {rem.items.filter(i => i.skip).length} with nothing to send
                </div>
                <div className="space-y-2">
                  {rem.items.map(i => {
                    const logged = (rem.log ?? []).filter(l => l.jobber_item_id === i.jobberItemId)
                    return (
                      <div key={i.jobberItemId} className="border border-gray-800 rounded-lg p-2.5 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{i.clientName || 'Unknown client'}</span>
                          <span className="text-xs text-gray-500 truncate max-w-[16rem]" title={i.title}>{i.title}</span>
                          <span className="text-xs text-gray-400">
                            {i.window ? `${fmtClock(i.window.start)}–${fmtClock(i.window.end)} (${i.window.source === 'promised' ? 'promised' : i.window.source === 'jobber' ? "Jobber's window" : i.window.source === 'title' ? 'from title' : 'planned'})` : 'anytime'}
                          </span>
                          <span className="text-xs text-sky-300">{i.template?.name ?? ''}</span>
                          {logged.map(l => <span key={l.channel} className={`text-[10px] px-1.5 rounded ${l.status === 'sent' ? 'bg-green-900 text-green-300' : l.status === 'failed' ? 'bg-red-900 text-red-300' : 'bg-gray-800'}`}>{l.channel} {l.status}</span>)}
                          {(i.sms || i.email_msg) && (
                            <button type="button" onClick={() => sendSample(i.jobberItemId)} className="ml-auto text-xs text-orange-400 hover:text-orange-300">Send me a sample</button>
                          )}
                        </div>
                        {i.skip && <div className="text-xs text-amber-400 mt-1">Nothing sends: {i.skip}</div>}
                        {i.sms && <div className="text-xs text-gray-300 mt-1 whitespace-pre-wrap"><span className="text-gray-500">Text → {i.sms.to}:</span> {i.sms.body}</div>}
                        {i.email_msg && <div className="text-xs text-gray-300 mt-1"><span className="text-gray-500">Email → {i.email_msg.to}:</span> <b>{i.email_msg.subject}</b></div>}
                        {remSample[i.jobberItemId] && <div className="text-xs text-gray-400 mt-1">{remSample[i.jobberItemId]}</div>}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
            <p className="text-[11px] text-gray-500 mt-3">Templates, send time and the on/off switch live in Admin → Routing → Dispatch → Day-before reminders. “Send me a sample” goes to your own phone (Settings → Profile) and login email — never to the customer.</p>
          </div>
        </div>
      )}

      {/* Optimize preview */}
      {optPreview && (
        <Modal onClose={() => setOptPreview(null)}>
          <h3 className="font-semibold mb-2">Optimized {new Date(`${optPreview.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })} — preview</h3>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto text-sm">
            {optPreview.results.map(r => {
              if (r.skipped) return <div key={r.techId} className="text-gray-400">{userName(r.techId)}: {r.skipped}</div>
              const moves = Object.entries(r.starts ?? {}).filter(([id, st]) => {
                const p = optPreview.ctx[id]
                return !p || p.startMin !== st
              })
              return (
                <div key={r.techId}>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: laneColor(r.techId) }} />
                    <span className="font-medium">{userName(r.techId)}</span>
                    <span className="text-xs text-gray-400">drive {r.beforeDriveMin} → <b className="text-white">{r.driveMin}</b> min{r.estimated ? ' (estimated)' : ''}</span>
                  </div>
                  <ol className="ml-5 mt-1 list-decimal text-xs text-gray-300">
                    {(r.order ?? []).map(id => {
                      const p = optPreview.ctx[id]
                      const st = r.starts?.[id]
                      const moved = !p || p.startMin !== st
                      return (
                        <li key={id} className={moved ? 'text-orange-300' : ''}>
                          {p?.stop.clientName ?? id} — {p?.startMin == null
                            ? <span className="text-gray-400">anytime (order only · est. {st != null ? fmtClock(st) : ''})</span>
                            : <>{moved ? `${fmtClock(p.startMin)} → ` : ''}{st != null ? fmtClock(st) : ''}</>}{p?.lock ? ' 🔒' : ''}
                        </li>
                      )
                    })}
                  </ol>
                  {moves.length === 0 && <div className="text-xs text-gray-500 ml-5">Already the best order — no changes.</div>}
                  {(r.violations ?? []).map(v => {
                    const p = optPreview.ctx[v.id]
                    return (
                      <div key={`${v.id}-${v.kind}`} className="text-xs text-red-400 ml-5">
                        ⚠ {p?.stop.clientName ?? v.id}: {v.kind === 'window' ? `can't make the promised time — ${v.lateMin} min late` : `arrives ${v.lateMin} min after the last arrival time`}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
          {optPreview.results.some(r => (r.violations ?? []).length > 0) && (
            <p className="text-xs text-amber-300 mt-3">No order keeps every promise. This is the closest it gets — consider moving a stop to another tech or day (Find a slot).</p>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" onClick={() => setOptPreview(null)} className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">Cancel</button>
            <button type="button" onClick={applyOptimize} className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-[#fff] text-sm font-medium">Put in draft</button>
          </div>
          <p className="text-[11px] text-gray-500 mt-2">Nothing changes in Jobber until you Send.</p>
        </Modal>
      )}

      {/* Window override prompt */}
      {windowPrompt && (
        <Modal onClose={() => setWindowPrompt(null)}>
          <h3 className="font-semibold mb-2">This stop has a promised time frame</h3>
          <p className="text-sm text-gray-300 mb-4">
            The customer was promised {fmtClock(windowPrompt.lock.startMin)} – {fmtClock(windowPrompt.lock.endMin)}. {fmtClock(windowPrompt.startMin)} is outside it.
          </p>
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" onClick={() => setWindowPrompt(null)} className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">Snap back</button>
            <button type="button" onClick={() => { const w = windowPrompt; setWindowPrompt(null); applyMove(w.stopId, w.lane, w.startMin, { overrideWindow: true }) }}
              className="px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-500 text-[#fff] text-sm">Move anyway — customer agreed</button>
          </div>
          <p className="text-[11px] text-gray-500 mt-3">“Move anyway” moves the promised time frame with the stop.</p>
        </Modal>
      )}

      {/* Send confirmation */}
      {sendOpen && (
        <Modal onClose={() => !sending && setSendOpen(false)}>
          <h3 className="font-semibold mb-2">Send {changes.length} change{changes.length === 1 ? '' : 's'} to Jobber?</h3>
          <div className="max-h-72 overflow-y-auto space-y-1 text-sm mb-3">
            {changes.map(c => (
              <div key={c.id} className="flex gap-2">
                <span className="flex-1 truncate">{c.clientName}</span>
                <span className="text-gray-400 text-xs">
                  {describeMove(c)}
                  {!c.fromTechIds.includes(c.toTechId) ? ` · to ${userName(c.toTechId)}` : ''}
                </span>
              </div>
            ))}
          </div>
          {remindersOut && changes.some(toldCustomer) && (
            <div className="bg-amber-900/30 border border-amber-700 text-amber-200 rounded-lg px-3 py-2 text-xs mb-3">
              Jobber&apos;s reminders for this day already went out ({fmtClock(hhmmToMinutes(settings.reminder_cutoff))} the day before), so {changes.filter(toldCustomer).length} customer{changes.filter(toldCustomer).length === 1 ? ' was' : 's were'} told the old time. After sending you&apos;ll get a one-tap text for each.
            </div>
          )}
          <p className="text-xs text-gray-500 mb-3">Each stop is re-checked in Jobber first. Anything someone else changed since is held back, not overwritten.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setSendOpen(false)} disabled={sending} className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">Cancel</button>
            <button type="button" onClick={send} disabled={sending} className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-[#fff] text-sm font-medium disabled:opacity-50">
              {sending ? 'Sending…' : 'Send to Jobber'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl p-5" onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  )
}

function StopPanel({ stop, placed, team, userName, lock, hasSavedLock, suggestion, onFindSlot, onClose, onMove, onLock, onUnlock, onUndoMove, onLength, dayLabel, onOpenDay }: {
  stop: DispatchStop
  placed: Placed | null
  team: string[]
  userName: (id: string) => string
  lock: { startMin: number; endMin: number } | null
  hasSavedLock: boolean
  suggestion: { start: number; end: number; label: string } | null
  onFindSlot?: () => void
  onClose: () => void
  onMove: (lane: string, hhmm: string) => void
  onLock: (startHHMM: string, endHHMM: string) => void
  onUnlock: () => void
  onUndoMove: () => void
  onLength?: (minutes: number) => void
  /** Week/Month: which day the stop is on, and a jump to it in Day view. */
  dayLabel?: string
  onOpenDay?: () => void
}) {
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const [lane, setLane] = useState(placed?.lane && team.includes(placed.lane) ? placed.lane : team[0] ?? '')
  const [time, setTime] = useState(placed?.startMin != null ? hhmm(placed.startMin) : '08:00')
  const [lengthMin, setLengthMin] = useState(String(placed?.durationMin ?? 30))
  const [lockStart, setLockStart] = useState(lock ? hhmm(lock.startMin) : suggestion ? hhmm(suggestion.start) : '10:00')
  const [lockEnd, setLockEnd] = useState(lock ? hhmm(lock.endMin) : suggestion ? hhmm(suggestion.end) : '12:00')
  const jobberWindow = stop.arrivalStart && stop.arrivalEnd
    ? `${fmtClock(isoToLocal(stop.arrivalStart).minutes)} – ${fmtClock(isoToLocal(stop.arrivalEnd).minutes)}` : null

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-2xl p-3 text-sm space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{stop.clientName}</div>
          <div className="text-xs text-gray-400 truncate">{stop.address || 'No address'}</div>
        </div>
        <button type="button" onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close">✕</button>
      </div>
      <div className="text-xs text-gray-400 space-y-0.5">
        <div className="truncate" title={stop.title}>{stop.kind !== 'visit' ? `${stop.kind[0].toUpperCase()}${stop.kind.slice(1)} · ` : ''}{stop.title}</div>
        {stop.lineItemNames.length > 0 && <div className="truncate" title={stop.lineItemNames.join(', ')}>{stop.lineItemNames.join(', ')}</div>}
        {stop.kind === 'visit' && <div>{money(stop.totalPrice)}</div>}
        <div>
          {dayLabel ? `${dayLabel} · ` : ''}{placed?.startMin != null ? `Planned ${fmtClock(placed.startMin)} – ${fmtClock(placed.endMin!)} · ${userName(placed.lane)}` : `No time set${dayLabel && placed?.lane ? ` · ${userName(placed.lane)}` : ''}`}
          {placed?.changed && <span className="text-orange-400"> · unsent</span>}
        </div>
        {jobberWindow && <div>Jobber arrival window: {jobberWindow}</div>}
        {stop.instructions && <div className="text-gray-500 line-clamp-3" title={stop.instructions}>{stop.instructions}</div>}
        {onOpenDay && <button type="button" onClick={onOpenDay} className="text-sky-400 hover:text-sky-300">Open this day →</button>}
      </div>

      {!stop.isComplete && (
        <div className="border-t border-gray-800 pt-2">
          <div className="text-xs font-medium mb-1">Move</div>
          <div className="flex gap-1.5">
            <select value={lane} onChange={e => setLane(e.target.value)} className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1 text-xs">
              {team.map(t => <option key={t} value={t}>{userName(t)}</option>)}
            </select>
            <input type="time" step={900} value={time} onChange={e => setTime(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1 text-xs" />
            <button type="button" onClick={() => lane && time && onMove(lane, time)} className="px-2.5 py-1 rounded-lg bg-orange-500 hover:bg-orange-400 text-[#fff] text-xs">Move</button>
          </div>
          {onLength && (
            <div className="flex gap-1.5 items-center mt-1.5">
              <span className="text-xs text-gray-400">Length</span>
              <input type="number" min={10} max={600} step={5} value={lengthMin} onChange={e => setLengthMin(e.target.value)}
                className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1 text-xs" />
              <span className="text-xs text-gray-500">min</span>
              <button type="button" onClick={() => { const n = Number(lengthMin); if (n >= 10) onLength(n) }}
                className="px-2.5 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs">Set</button>
            </div>
          )}
          {placed?.changed && <button type="button" onClick={onUndoMove} className="mt-1 text-[11px] text-gray-400 hover:text-white">Put it back where Jobber has it</button>}
          {onFindSlot && stop.routable && <button type="button" onClick={onFindSlot} className="mt-1 ml-3 text-[11px] text-emerald-400 hover:text-emerald-300">Find a slot</button>}
        </div>
      )}

      <div className="border-t border-gray-800 pt-2">
        <div className="text-xs font-medium mb-1">Promised time frame {lock ? <span className="text-pink-400">🔒 {fmtClock(lock.startMin)} – {fmtClock(lock.endMin)}</span> : <span className="text-gray-500">— none (anytime)</span>}</div>
        <div className="flex gap-1.5 items-center">
          <input type="time" step={900} value={lockStart} onChange={e => setLockStart(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1 text-xs" />
          <span className="text-xs text-gray-500">to</span>
          <input type="time" step={900} value={lockEnd} onChange={e => setLockEnd(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1 text-xs" />
          <button type="button" onClick={() => onLock(lockStart, lockEnd)} className="px-2.5 py-1 rounded-lg bg-pink-600 hover:bg-pink-500 text-[#fff] text-xs">{hasSavedLock ? 'Update' : 'Lock'}</button>
          {hasSavedLock && <button type="button" onClick={onUnlock} className="px-2 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs">Unlock</button>}
        </div>
        {!lock && suggestion && (
          <p className="text-[11px] text-pink-300 mt-1">The title says “{suggestion.label}” — {fmtClock(suggestion.start)} – {fmtClock(suggestion.end)} is filled in above. Click Lock if that was promised.</p>
        )}
        <p className="text-[10px] text-gray-500 mt-1">Locked stops show as PROMISED. A lock is saved right away; it lives in Hub, not Jobber.</p>
      </div>
    </div>
  )
}

/** Line-item filter (Ben, Oct 20 2026): tick the line items to show. */
function LineItemPicker({ options, selected, onChange }: { options: string[]; selected: string[]; onChange: (items: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const sel = new Set(selected)
  const shown = options.filter(o => o.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`px-2.5 py-1 rounded-full text-xs border ${selected.length ? 'bg-orange-500 border-orange-500 text-[#fff]' : 'border-gray-700 text-gray-300 hover:border-gray-500'}`}>
        Line items{selected.length ? ` (${selected.length})` : ''} ▾
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-80 bg-gray-900 border border-gray-700 rounded-xl shadow-xl p-2">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search line items"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs mb-1.5" />
          <div className="flex gap-3 text-[11px] mb-1">
            <button type="button" onClick={() => onChange([...new Set([...selected, ...shown])])} className="text-gray-400 hover:text-white">Tick all shown</button>
            <button type="button" onClick={() => onChange(selected.filter(x => !shown.includes(x)))} className="text-gray-400 hover:text-white">Untick all shown</button>
            <button type="button" onClick={() => onChange([])} className="text-gray-400 hover:text-white">Show everything</button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {shown.map(o => (
              <label key={o} className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-gray-800 text-xs cursor-pointer">
                <input type="checkbox" checked={sel.has(o)} onChange={() => onChange(sel.has(o) ? selected.filter(x => x !== o) : [...selected, o])} />
                <span className="truncate">{o}</span>
              </label>
            ))}
            {shown.length === 0 && <div className="text-xs text-gray-500 p-1">No line items match. (The list comes from Admin → Routing → Refresh from Jobber, plus the stops on screen.)</div>}
          </div>
          <div className="flex items-center mt-1.5">
            <span className="text-[10px] text-gray-500 flex-1">{selected.length ? 'Only stops with a ticked line item show.' : 'Nothing ticked = every stop shows.'}</span>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-300 hover:text-white">Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

function SaveViewModal({ active, onClose, onSave, summary }: {
  active: { id: string; name: string; config: DispatchViewConfig; shared: boolean } | null
  onClose: () => void
  onSave: (name: string, datePreset: DatePreset, shared: boolean, overwriteId: string | null) => void
  summary: string
}) {
  const [name, setName] = useState(active?.name ?? '')
  const [preset, setPreset] = useState<DatePreset>(active?.config.datePreset ?? 'today')
  const [shared, setShared] = useState(active?.shared ?? false)
  const [overwrite, setOverwrite] = useState(!!active)
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl p-5 space-y-3 text-sm" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold">Save view</h3>
        <p className="text-xs text-gray-400">Saves what&apos;s on screen now: {summary}, plus whether Unscheduled and Tanks are showing.</p>
        {active && (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
            Update “{active.name}” (untick to save as a new view)
          </label>
        )}
        <label className="block">
          <div className="text-xs text-gray-400 mb-1">Name</div>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Weed & Feed — this week"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5" />
        </label>
        <label className="block">
          <div className="text-xs text-gray-400 mb-1">When I pick this view, go to</div>
          <select value={preset} onChange={e => setPreset(e.target.value as DatePreset)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5">
            {DATE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} />
          Share with the team (everyone with Routing can pick it; only you can change it)
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700">Cancel</button>
          <button type="button" disabled={!name.trim()} onClick={() => onSave(name.trim(), preset, shared, overwrite && active ? active.id : null)}
            className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-[#fff] font-medium disabled:opacity-40">Save</button>
        </div>
      </div>
    </div>
  )
}
