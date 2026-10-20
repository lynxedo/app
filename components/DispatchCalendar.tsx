'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import DispatchMap, { type DispatchMapLeg, type DispatchMapStop } from '@/components/DispatchMap'
import DispatchRoutePanel, { type OptimizeRequest, type PanelLane, readPanelOff, sendLasso } from '@/components/DispatchRoutePanel'
import { resolvePinColors, type PinSettings } from '@/lib/pin-colors'
import DispatchTankPanel from '@/components/DispatchTankPanel'
import DispatchAddonStripe from '@/components/DispatchAddonStripe'
import type { CapacityData } from '@/lib/route-capacity'
import type { OptCtxStop } from '@/app/dashboard/DispatchView'
import { fetchLeg, type LatLng } from '@/lib/dispatch-legs'
import {
  type DispatchSettings, type DispatchStop, type DraftChange,
  addDays, changeDate, fmtClock, hhmmToMinutes, insertInOrder, isoToLocal, matchesItemFilter, orderRoute, stopColor, stopMatchesGroup, todayLocal,
} from '@/lib/dispatch'

// Dispatch Week + Month views (Reference/PRDs/DISPATCH_ROUTING_PRD.md Phase 3).
// Reads Hub's copy of Jobber for the range; the draft (all days) is laid over
// it, so moves show where they're going (orange outline) before they're sent.
//
// Ben, Oct 20 2026 — organize stops right here:
//  • drag a stop onto another stop the same day + tech  → put it just before
//    (the Hub route order — Jobber can't store anytime order);
//  • drag it onto another day / tech                    → move it (draft);
//    an anytime stop moves as anytime, a timed one keeps its clock time.
// 🗺 on a day maps that day, every stop numbered in route order (anytime ones
// too) with real road paths. Click the day number to open the live Day view.

export type RangeStop = DispatchStop & {
  startMin: number | null
  endMin: number | null
  locked: boolean
  lock: { start: string; end: string } | null
}
type EffStop = RangeStop & { changed: boolean; origDate: string | null }

interface Props {
  view: 'week' | 'month'
  date: string
  team: string[]
  settings: DispatchSettings
  filters: { groups: string[]; hideZero: boolean; items: string[] }
  userName: (id: string) => string
  laneColor: (id: string) => string
  onOpenDay: (date: string) => void
  changes: DraftChange[]
  orders: Record<string, string[]>
  onOrdersLoaded: (o: Record<string, string[]>) => void
  onSaveOrder: (date: string, techId: string, ids: string[]) => void
  onMoveStop: (stop: RangeStop, fromDate: string | null, toDate: string, toTechId: string) => void
  reloadKey: number
  /** Optimize the 🗺 day — same preview + apply as Day view. */
  onOptimizeDay: (date: string, req: OptimizeRequest, ctx: Record<string, OptCtxStop>, routeIds: Record<string, string[]>, depot: LatLng | null) => void
  optimizing: boolean
  showTanks: boolean
  capacity: CapacityData | null
  onLoadCapacity: () => void
  pinSettings: PinSettings | null
  tickOff: Record<string, string[]>
  pinNumbers: 'route' | 'last'
  onPinNumbers: (m: 'route' | 'last') => void
}

const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()
/** Monday on or before `d`. */
const weekStart = (d: string) => addDays(d, -((weekday(d) + 6) % 7))
const dayNum = (d: string) => Number(d.slice(8, 10))
const label = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
const minutesOf = (local: string) => Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16))
const MONTH_CHIPS = 6
const LS_SPLIT = 'lynxedo-dispatch-month-split'
const LS_WEEKMAP = 'lynxedo-dispatch-week-map-h'
const readNum = (k: string, d: number) => { try { const v = Number(localStorage.getItem(k)); return Number.isFinite(v) && v > 0 ? v : d } catch { return d } }
const writeNum = (k: string, v: number) => { try { localStorage.setItem(k, String(Math.round(v))) } catch {} }

export default function DispatchCalendar({
  view, date, team, settings, filters, userName, laneColor, onOpenDay,
  changes, orders, onOrdersLoaded, onSaveOrder, onMoveStop, reloadKey, onOptimizeDay, optimizing,
  showTanks, capacity, onLoadCapacity, pinSettings, tickOff, pinNumbers, onPinNumbers,
}: Props) {
  const [days, setDays] = useState<Record<string, RangeStop[]>>({})
  const [depot, setDepot] = useState<LatLng | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [coords, setCoords] = useState<Record<string, LatLng | null>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandAll, setExpandAll] = useState(false)
  const [mapDay, setMapDay] = useState<string | null>(null)
  const [legs, setLegs] = useState<DispatchMapLeg[]>([])
  const [dropKey, setDropKey] = useState<string | null>(null)
  // Resizable panes (Ben, Oct 2026): Month = calendar | map side by side with a
  // draggable divider; Week = calendar over map with a draggable height.
  const [split, setSplit] = useState(62)          // calendar width %, Month
  const [weekMapH, setWeekMapH] = useState(520)   // map height px, Week
  useEffect(() => { setSplit(readNum(LS_SPLIT, 62)); setWeekMapH(readNum(LS_WEEKMAP, 520)) }, [])
  const rowRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: string } | null>(null)

  const dragSplit = (e: React.PointerEvent) => {
    e.preventDefault()
    const rect = rowRef.current?.getBoundingClientRect()
    if (!rect) return
    let v = split
    const move = (ev: PointerEvent) => { v = Math.min(85, Math.max(25, ((ev.clientX - rect.left) / rect.width) * 100)); setSplit(v) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); writeNum(LS_SPLIT, v) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const dragWeekMap = (e: React.PointerEvent) => {
    e.preventDefault()
    const y0 = e.clientY, h0 = weekMapH
    let v = h0
    const move = (ev: PointerEvent) => { v = Math.min(1600, Math.max(240, h0 + (ev.clientY - y0))); setWeekMapH(v) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); writeNum(LS_WEEKMAP, v) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  const { from, to, cells } = useMemo(() => {
    if (view === 'week') {
      const f = weekStart(date)
      return { from: f, to: addDays(f, 6), cells: Array.from({ length: 7 }, (_, i) => addDays(f, i)) }
    }
    const f = weekStart(`${date.slice(0, 7)}-01`)
    const cells = Array.from({ length: 42 }, (_, i) => addDays(f, i))
    return { from: f, to: cells[41], cells }
  }, [view, date])

  const teamKey = team.join(',')
  useEffect(() => {
    if (!teamKey) { setDays({}); return }
    let cancelled = false
    setLoading(true); setError(null)
    Promise.all([
      fetch(`/api/hub/routing/dispatch/range?from=${from}&to=${to}&techIds=${encodeURIComponent(teamKey)}`).then(r => r.json().then(d => ({ ok: r.ok, d }))),
      fetch(`/api/hub/routing/dispatch/order?from=${from}&to=${to}&techIds=${encodeURIComponent(teamKey)}`).then(r => r.json()).catch(() => ({})),
    ])
      .then(([{ ok, d }, o]) => {
        if (cancelled) return
        if (!ok) throw new Error(d.error || 'Could not load')
        setDays(d.days ?? {})
        setDepot(d.depot ?? null)
        if (o?.orders) onOrdersLoaded(o.orders)
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, teamKey, reloadKey])

  // The draft laid over Hub's copy: a moved stop leaves its old day and shows
  // on its new one (orange outline); a bucket card or a stop from outside the
  // range comes from the change's snapshot.
  const effDays = useMemo(() => {
    const out: Record<string, EffStop[]> = {}
    const changeMap = new Map(changes.map(c => [c.id, c]))
    const seen = new Set<string>()
    for (const [d, list] of Object.entries(days)) {
      for (const s of list) {
        seen.add(s.id)
        const ch = changeMap.get(s.id)
        if (!ch) { (out[d] ??= []).push({ ...s, changed: false, origDate: d }); continue }
        const nd = changeDate(ch)
        ;(out[nd] ??= []).push({
          ...s, techIds: [ch.toTechId],
          startMin: ch.anytime ? null : minutesOf(ch.toStart),
          endMin: ch.anytime ? null : minutesOf(ch.toEnd),
          changed: true, origDate: d,
        })
      }
    }
    for (const c of changes) {
      if (seen.has(c.id) || !c.snapshot) continue
      const nd = changeDate(c)
      if (nd < from || nd > to) continue
      ;(out[nd] ??= []).push({
        id: c.id, kind: c.kind, clientName: c.clientName, phone: c.phone,
        address: c.snapshot.address, routable: c.snapshot.routable, title: c.snapshot.title,
        lineItemNames: c.snapshot.lineItemNames, totalPrice: c.snapshot.totalPrice, instructions: c.snapshot.instructions ?? null,
        startAt: null, endAt: null, allDay: !!c.anytime, isComplete: false, arrivalStart: null, arrivalEnd: null,
        techIds: [c.toTechId], startMin: c.anytime ? null : minutesOf(c.toStart), endMin: c.anytime ? null : minutesOf(c.toEnd),
        locked: false, lock: null, changed: true, origDate: null,
      })
    }
    return out
  }, [days, changes, from, to])

  // Days since last visit for every visit in range ("18d" tags, pin numbers).
  const [lastDays, setLastDays] = useState<Record<string, number | null>>({})
  const visitKey = useMemo(() => [...new Set(Object.values(effDays).flat().filter(s => s.kind === 'visit').map(s => s.id))].sort().join(','), [effDays])
  useEffect(() => {
    if (!visitKey) return
    let cancelled = false
    const ids = visitKey.split(',')
    ;(async () => {
      for (let i = 0; i < ids.length; i += 400) {
        try {
          const r = await fetch('/api/hub/routing/dispatch/last-visits', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitIds: ids.slice(i, i + 400) }),
          })
          const d = await r.json()
          if (cancelled) return
          setLastDays(prev => ({ ...prev, ...(d.days ?? {}) }))
        } catch {}
      }
    })()
    return () => { cancelled = true }
  }, [visitKey])

  // Geocode every address in range (server geocoder + cache, same as the optimizer).
  useEffect(() => {
    const want = [...new Set(Object.values(effDays).flat().map(s => s.address).filter(a => a && !(a in coords)))]
    if (want.length === 0) return
    let cancelled = false
    ;(async () => {
      for (let i = 0; i < want.length; i += 40) {
        const chunk = want.slice(i, i + 40)
        const got: Record<string, LatLng | null> = {}
        try {
          const res = await fetch('/api/geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addresses: chunk }) })
          const d = await res.json()
          chunk.forEach((a, j) => { got[a] = d.coords?.[j] ?? null })
        } catch { chunk.forEach(a => { got[a] = null }) }
        if (cancelled) return
        setCoords(prev => ({ ...prev, ...got }))
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effDays])

  const dim = (s: DispatchStop) => {
    if (filters.hideZero && Math.abs(s.totalPrice) < 0.005) return true
    if (!matchesItemFilter(s, filters.items)) return true
    const active = settings.filter_groups.filter(g => filters.groups.includes(g.id))
    return active.length > 0 && !active.some(g => stopMatchesGroup(s, g))
  }
  // Color language (Ben, Oct 20 2026): fill = service (stop colors, else the
  // Pin Colors base program), left edge = tech, right edge = add-on programs.
  const colorOf = (s: EffStop | RangeStop) => stopColor(s, settings.color_rules, s.locked, resolvePinColors(s.lineItemNames, pinSettings).baseColor)
  const addonsOf = (s: EffStop | RangeStop) => resolvePinColors(s.lineItemNames, pinSettings).auxColors.slice(0, 3)
  const today = todayLocal()
  const viewStart = hhmmToMinutes(settings.view_start)
  const span = Math.max(60, hhmmToMinutes(settings.view_end) - viewStart)
  const isOpen = (key: string) => expandAll || expanded.has(key)
  const toggle = (key: string) => setExpanded(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })

  /** One tech's stops on a day, in route order. */
  const routeOf = (d: string, techId: string): EffStop[] =>
    orderRoute((effDays[d] ?? []).filter(s => s.techIds.includes(techId)), orders[`${d}|${techId}`])
  const techOf = (s: EffStop) => team.find(t => s.techIds.includes(t)) ?? s.techIds[0] ?? ''
  /** All of a day's stops, grouped by tech (team order), each group in route order. */
  const dayList = (d: string): EffStop[] => {
    const grouped = team.flatMap(t => routeOf(d, t))
    const rest = (effDays[d] ?? []).filter(s => !grouped.includes(s))
    return [...grouped, ...rest]
  }

  // ── Drag and drop ─────────────────────────────────────────────────────────
  const findEff = (id: string): { s: EffStop; d: string } | null => {
    for (const [d, list] of Object.entries(effDays)) { const s = list.find(x => x.id === id); if (s) return { s, d } }
    return null
  }
  const startDrag = (e: React.DragEvent, s: EffStop) => {
    e.stopPropagation()
    dragRef.current = { id: s.id }
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', s.id) } catch {}
  }
  const allowDrop = (e: React.DragEvent, key: string) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dropKey !== key) setDropKey(key) }
  /** Drop `dragged` on day `d`, tech `techId`, just before `beforeId` (null = at the end). */
  const dropAt = (d: string, techId: string | null, beforeId: string | null) => {
    setDropKey(null)
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.id === beforeId) return
    const found = findEff(drag.id)
    if (!found) return
    const { s, d: fromDay } = found
    const tech = techId ?? techOf(s)
    const ids = routeOf(d, tech).map(x => x.id)
    if (!(fromDay === d && s.techIds.includes(tech))) onMoveStop(s, s.origDate, d, tech)
    onSaveOrder(d, tech, insertInOrder(ids, s.id, beforeId))
  }

  // ── Map ───────────────────────────────────────────────────────────────────
  const inRange = (d: string) => (view === 'month' ? d.slice(0, 7) === date.slice(0, 7) : true)
  const dayRoutes = useMemo(() => {
    if (!mapDay) return []
    return team.map(t => ({ techId: t, route: routeOf(mapDay, t).filter(s => s.routable && coords[s.address]) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapDay, effDays, team, orders, coords])

  const mapStops: DispatchMapStop[] = useMemo(() => {
    const out: DispatchMapStop[] = []
    const push = (s: EffStop, techId: string, labelText: string, meta: string) => {
      const c = coords[s.address]
      if (!c) return
      out.push({
        id: `${s.id}|${techId}`, lat: c.lat, lng: c.lng, label: labelText, color: laneColor(techId),
        fill: dim(s) ? '#94a3b8' : colorOf(s), locked: s.locked,
        title: s.clientName, subtitle: s.address, meta,
        halo: addonsOf(s),
        faded: !!mapDay && (tickOff[mapDay] ?? readPanelOff(mapDay)).includes(s.id),
      })
    }
    if (mapDay) {
      for (const r of dayRoutes) {
        r.route.forEach((s, i) => push(s, r.techId, pinNumbers === 'last' ? (lastDays[s.id] != null ? String(lastDays[s.id]) : '–') : String(i + 1), `${userName(r.techId)} · ${s.startMin != null ? fmtClock(s.startMin) : 'anytime'}`))
      }
    } else {
      for (const [d, list] of Object.entries(effDays)) {
        if (!inRange(d)) continue
        for (const s of list) {
          const t = techOf(s)
          push(s, t, pinNumbers === 'last' && lastDays[s.id] != null ? String(lastDays[s.id]) : '', `${label(d, { weekday: 'short', month: 'short', day: 'numeric' })} · ${userName(t)}${s.startMin != null ? ` · ${fmtClock(s.startMin)}` : ''}`)
        }
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapDay, dayRoutes, effDays, coords, settings.color_rules, filters, team, pinSettings, tickOff, pinNumbers, lastDays])

  // Road legs for the one day being mapped: shop → every stop in ROUTE order
  // (anytime ones included — Ben, Oct 20 2026) → shop.
  const legKey = useMemo(() => dayRoutes.map(r => `${r.techId}:${r.route.map(s => s.address).join(';')}`).join('|'), [dayRoutes])
  useEffect(() => {
    if (!mapDay) { setLegs([]); return }
    let cancelled = false
    ;(async () => {
      const out: DispatchMapLeg[] = []
      for (const r of dayRoutes) {
        const pts = r.route.map(s => coords[s.address]).filter((c): c is LatLng => !!c)
        if (pts.length === 0) continue
        const names = [...(depot ? ['Shop'] : []), ...r.route.map((s, i) => `${i + 1}. ${s.clientName}`), ...(depot ? ['Shop'] : [])]
        const path = [...(depot ? [depot] : []), ...pts, ...(depot ? [depot] : [])]
        for (let i = 0; i < path.length - 1; i++) {
          const leg = await fetchLeg(path[i], path[i + 1])
          const isReturn = !!depot && i === path.length - 2
          out.push({
            coords: leg.coords, color: laneColor(r.techId), isReturn,
            label: isReturn ? `back to shop · ${leg.minutes} min` : '',
            tooltip: `${names[i] ?? ''} → ${names[i + 1] ?? ''} · ${leg.minutes} min · ${leg.miles} mi${leg.estimated ? ' (estimate)' : ''}`,
          })
        }
      }
      if (!cancelled) setLegs(out)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legKey, mapDay, depot])

  // Route & optimize for the 🗺 day (same panel as Day view).
  const panelLanes: PanelLane[] = mapDay ? team.map(t => ({
    techId: t, name: userName(t), color: laneColor(t),
    stops: routeOf(mapDay, t).map(s => ({
      id: s.id, clientName: s.clientName, title: s.title, startMin: s.startMin,
      mapped: s.routable && !!coords[s.address], routable: s.routable, locked: s.locked,
      isComplete: s.isComplete, changed: s.changed,
    })).sort((a, b) => Number(b.mapped) - Number(a.mapped)),
  })) : []
  const optimizeMapDay = (req: OptimizeRequest) => {
    if (!mapDay) return
    const ctx: Record<string, OptCtxStop> = {}
    const routeIds: Record<string, string[]> = {}
    for (const t of team) {
      const r = routeOf(mapDay, t)
      routeIds[t] = r.filter(s => s.routable && coords[s.address]).map(s => s.id)
      for (const s of r) {
        const c = coords[s.address]
        const la = s.lock ? isoToLocal(s.lock.start) : null, lb = s.lock ? isoToLocal(s.lock.end) : null
        ctx[s.id] = {
          stop: s, startMin: s.startMin,
          durationMin: s.startMin != null && s.endMin != null && s.endMin > s.startMin ? s.endMin - s.startMin : null,
          lock: la && lb && la.date === mapDay ? { startMin: la.minutes, endMin: lb.minutes } : null,
          lane: t, lat: c?.lat ?? null, lng: c?.lng ?? null,
        }
      }
    }
    onOptimizeDay(mapDay, req, ctx, routeIds, depot)
  }

  const depots = useMemo(() => (depot ? [{ ...depot, label: 'Shop' }] : []), [depot])
  const noop = () => {}

  if (team.length === 0) return null

  const mapBtn = (d: string) => (
    <span role="button" tabIndex={0} title="Show this day on the map"
      onClick={e => { e.stopPropagation(); setMapDay(m => (m === d ? null : d)) }}
      onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setMapDay(m => (m === d ? null : d)) } }}
      className={`ml-1 px-1 rounded text-[10px] cursor-pointer ${mapDay === d ? 'bg-orange-500 text-[#fff]' : 'text-gray-500 hover:text-white'}`}>🗺</span>
  )

  /** A draggable stop chip. `n` = its route number for that tech, if any. */
  const chip = (s: EffStop, d: string, n: number | null, big: boolean) => {
    const t = techOf(s)
    return (
      <div key={s.id}
        draggable={!s.isComplete}
        onDragStart={e => startDrag(e, s)}
        onDragOver={e => allowDrop(e, `${d}|${s.id}`)}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); dropAt(d, t, s.id) }}
        onClick={e => e.stopPropagation()}
        className={`relative overflow-hidden ${big ? 'text-[12px] mt-1 py-0.5' : 'text-[12px] py-0.5'} leading-snug pl-1.5 pr-2.5 rounded text-[#fff] break-words ${s.isComplete ? 'cursor-default' : 'cursor-grab'} ${s.changed ? 'ring-2 ring-orange-400' : ''} ${dropKey === `${d}|${s.id}` ? 'border-t-2 border-white' : ''}`}
        style={{ background: colorOf(s), opacity: dim(s) ? 0.35 : s.isComplete ? 0.7 : 1, borderLeft: `3px solid ${laneColor(t)}` }}
        title={`${s.clientName}${s.locked ? ' · promised' : ''}${s.changed ? ' · moved (unsent)' : ''} — drag onto another stop to put it before that one, or onto another day to move it`}>
        {n != null && <span className="inline-block min-w-[1.1rem] text-center mr-1 rounded bg-black/30 text-[10px] font-bold">{n}</span>}
        {s.isComplete ? '✓ ' : ''}{s.startMin != null ? <b>{fmtClock(s.startMin)} </b> : ''}{s.title || s.clientName}{s.locked ? ' 🔒' : ''}
        {lastDays[s.id] != null && <span className="ml-1 text-[10px] px-0.5 rounded bg-black/25" title="Days since the last completed visit">{lastDays[s.id]}d</span>}
        <DispatchAddonStripe colors={addonsOf(s)} width={4} />
      </div>
    )
  }

  const calendar = (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 overflow-x-auto min-w-0">
      <div className="flex flex-wrap items-center gap-2 mb-2 text-sm">
        <span className="font-semibold">
          {view === 'week' ? `Week of ${label(from, { month: 'short', day: 'numeric' })}` : label(`${date.slice(0, 7)}-15`, { month: 'long', year: 'numeric' })}
        </span>
        {loading && <span className="text-xs text-gray-500">Loading…</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
        <button type="button" onClick={() => { setExpandAll(x => !x); setExpanded(new Set()) }} className="ml-auto text-xs text-gray-400 hover:text-white">
          {expandAll ? 'Collapse all' : 'Expand all'}
        </button>
        <span className="text-[11px] text-gray-500">Drag stops to reorder or move them · click a day number to open that day</span>
      </div>

      {view === 'week' ? (
        <div className="min-w-[760px] grid" style={{ gridTemplateColumns: `8rem repeat(7, minmax(0, 1fr))` }}>
          <div />
          {cells.map(d => (
            <div key={d} className="flex items-center justify-center">
              <button type="button" onClick={() => onOpenDay(d)} title="Open this day"
                className={`text-xs py-1 px-1 rounded hover:bg-gray-800 ${d === today ? 'text-orange-400 font-semibold' : 'text-gray-400'}`}>
                {label(d, { weekday: 'short', month: 'numeric', day: 'numeric' })}
              </button>
              {mapBtn(d)}
            </div>
          ))}
          {team.map(t => (
            <WeekRowCells key={t} techId={t} cells={cells} name={userName(t)} color={laneColor(t)}
              routeOf={routeOf} settings={settings} dim={dim} viewStart={viewStart} span={span}
              isOpen={isOpen} toggle={toggle} chip={chip} allowDrop={allowDrop} dropAt={dropAt} dropKey={dropKey} colorOf={colorOf} />
          ))}
        </div>
      ) : (
        <div className="min-w-[640px] grid grid-cols-7 gap-px bg-gray-800 rounded-lg overflow-hidden">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => <div key={w} className="bg-gray-900 text-xs font-medium text-gray-400 text-center py-1.5">{w}</div>)}
          {cells.map(d => {
            const list = dayList(d).filter(s => !dim(s))
            const inMonth = d.slice(0, 7) === date.slice(0, 7)
            const open = isOpen(d)
            const shown = open ? list : list.slice(0, MONTH_CHIPS)
            return (
              <div key={d}
                onDragOver={e => allowDrop(e, `cell|${d}`)}
                onDragLeave={() => setDropKey(k => (k === `cell|${d}` ? null : k))}
                onDrop={e => { e.preventDefault(); dropAt(d, null, null) }}
                className={`bg-gray-900 text-left p-1.5 min-h-[150px] min-w-0 ${inMonth ? '' : 'opacity-40'} ${mapDay === d ? 'ring-1 ring-orange-500 ring-inset' : ''} ${dropKey === `cell|${d}` ? 'bg-gray-800' : ''}`}>
                <div className="flex items-center text-sm mb-1">
                  <button type="button" onClick={() => onOpenDay(d)} title="Open this day"
                    className={`rounded px-1 hover:bg-gray-700 ${d === today ? 'text-orange-400 font-bold' : 'text-gray-300 font-medium'}`}>{dayNum(d)}</button>
                  {list.length > 0 && mapBtn(d)}
                  <span className="ml-auto flex gap-1">
                    {team.map(t => {
                      const n = list.filter(s => s.techIds.includes(t)).length
                      return n ? (
                        <span key={t} className="text-[11px] px-1.5 rounded text-[#fff]" style={{ background: laneColor(t) }} title={userName(t)}>{n}</span>
                      ) : null
                    })}
                  </span>
                </div>
                {shown.map(s => {
                  const t = techOf(s)
                  const idx = routeOf(d, t).findIndex(x => x.id === s.id)
                  return chip(s, d, idx >= 0 ? idx + 1 : null, true)
                })}
                {list.length > MONTH_CHIPS && !expandAll && (
                  <button type="button" onClick={e => { e.stopPropagation(); toggle(d) }} className="text-xs text-sky-400 hover:text-sky-300 mt-1">
                    {open ? 'Less' : `More (${list.length - MONTH_CHIPS})`}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  const map = (
    <div className="space-y-1 min-w-0">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        {mapDay
          ? <>Map: <b className="text-white">{label(mapDay, { weekday: 'long', month: 'short', day: 'numeric' })}</b> — numbered in route order, real road paths
              <button type="button" onClick={() => setMapDay(null)} className="ml-auto text-gray-400 hover:text-white">Show the whole {view}</button></>
          : <>Map: every visit this {view} · 🗺 on a day shows just that day&apos;s routes</>}
      </div>
      <DispatchMap depots={depots} stops={mapStops} legs={mapDay ? legs : []} unscheduled={[]} highlightId={null} onStopClick={noop}
        onLasso={mapDay ? (ids, mode) => sendLasso(mapDay, ids.map(x => x.split('|')[0]), mode) : undefined}
        numberMode={pinNumbers} onNumberMode={onPinNumbers}
        height={view === 'week' ? `${weekMapH}px` : mapDay ? 'max(420px, calc(100vh - 420px))' : 'max(520px, calc(100vh - 140px))'} />
      {mapDay && (
        <div className="pt-2">
          <DispatchRoutePanel date={mapDay} lanes={panelLanes} busy={optimizing} onOptimize={optimizeMapDay} onClose={() => setMapDay(null)} />
          {showTanks && (
            <div className="mt-2 space-y-2">
              {team.map(t => (
                <DispatchTankPanel key={t} date={mapDay} techId={t} techName={userName(t)}
                  stops={routeOf(mapDay, t).map(s => ({ id: s.id, clientName: s.clientName, jobTitle: s.title, lineItemNames: s.lineItemNames }))}
                  capacity={capacity} onLoadCapacity={onLoadCapacity} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )

  if (view === 'week') {
    return (
      <div className="space-y-1">
        {calendar}
        <div onPointerDown={dragWeekMap} className="h-2 mx-auto w-24 rounded-full bg-gray-700 hover:bg-orange-500 cursor-row-resize" title="Drag to make the map taller or shorter" />
        {map}
      </div>
    )
  }
  return (
    <div ref={rowRef} className="flex flex-col lg:flex-row gap-4 lg:gap-0 items-stretch" style={{ ['--cal-w' as string]: `${split}%` }}>
      <div className="w-full lg:w-[var(--cal-w)] min-w-0 lg:pr-2">{calendar}</div>
      <div onPointerDown={dragSplit} className="hidden lg:block w-2 shrink-0 cursor-col-resize group" title="Drag to resize the calendar and the map">
        <div className="mx-auto h-full w-1 rounded-full bg-gray-700 group-hover:bg-orange-500" />
      </div>
      <div className="flex-1 min-w-0 lg:pl-2"><div className="lg:sticky lg:top-2">{map}</div></div>
    </div>
  )
}

function WeekRowCells({ techId, cells, name, color, routeOf, dim, viewStart, span, isOpen, toggle, chip, allowDrop, dropAt, dropKey, colorOf }: {
  techId: string; cells: string[]; name: string; color: string
  routeOf: (d: string, techId: string) => EffStop[]
  settings: DispatchSettings; dim: (s: DispatchStop) => boolean; viewStart: number; span: number
  isOpen: (key: string) => boolean; toggle: (key: string) => void
  chip: (s: EffStop, d: string, n: number | null, big: boolean) => React.ReactNode
  allowDrop: (e: React.DragEvent, key: string) => void
  dropAt: (d: string, techId: string | null, beforeId: string | null) => void
  dropKey: string | null
  colorOf: (s: EffStop) => string
}) {
  return (
    <>
      <div className="flex items-center gap-1.5 text-sm font-medium py-2 border-t border-gray-800 pr-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
        <span className="truncate">{name}</span>
      </div>
      {cells.map(d => {
        const list = routeOf(d, techId)
        const timed = list.filter(s => s.startMin != null)
        const anytime = list.length - timed.length
        const key = `${d}|${techId}`
        const open = isOpen(key)
        return (
          <div key={d}
            onDragOver={e => allowDrop(e, `wk|${key}`)}
            onDrop={e => { e.preventDefault(); dropAt(d, techId, null) }}
            className={`border-t border-l border-gray-800 p-1 text-left min-w-0 ${dropKey === `wk|${key}` ? 'bg-gray-800' : ''}`}>
            <div className="relative h-6 rounded bg-gray-950/60 overflow-hidden">
              {timed.map(s => (
                <div key={s.id} className="absolute top-0.5 bottom-0.5 rounded-sm"
                  title={`${fmtClock(s.startMin!)} ${s.clientName}${s.locked ? ' · promised' : ''}`}
                  style={{
                    left: `${Math.max(0, ((s.startMin! - viewStart) / span) * 100)}%`,
                    width: `${Math.max(3, (((s.endMin ?? s.startMin! + 30) - s.startMin!) / span) * 100)}%`,
                    background: colorOf(s),
                    opacity: dim(s) ? 0.25 : s.isComplete ? 0.5 : 1,
                  }} />
              ))}
            </div>
            <div className="flex items-center text-[11px] text-gray-400 mt-0.5">
              <span>{list.length ? `${list.length} stop${list.length === 1 ? '' : 's'}` : '—'}{anytime ? ` · ${anytime} anytime` : ''}</span>
              {list.length > 0 && (
                <button type="button" onClick={e => { e.stopPropagation(); toggle(key) }} className="ml-auto text-sky-400 hover:text-sky-300">
                  {open ? 'Less' : 'More'}
                </button>
              )}
            </div>
            {open && (
              <div className="mt-1 space-y-0.5">
                {list.map((s, i) => chip(s, d, i + 1, false))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
