'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import DispatchMap, { type DispatchMapLeg, type DispatchMapStop } from '@/components/DispatchMap'
import { fetchLeg, type LatLng } from '@/lib/dispatch-legs'
import {
  type DispatchSettings, type DispatchStop, addDays, fmtClock, hhmmToMinutes, stopColor, stopMatchesGroup, todayLocal,
} from '@/lib/dispatch'

// Dispatch Week + Month views (Reference/PRDs/DISPATCH_ROUTING_PRD.md Phase 3).
// Read-only overview from the Hub mirror; click a day to open its live Day view,
// where moves happen. Week = a mini timeline strip per tech per day; Month =
// counts per tech + the first stops. Cells stay compact — "More" opens one up
// (Ben, Oct 2026: auto-expanding cells took more room than needed).
// The map shows the whole range as dots, or — after 🗺 on a day — that day's
// stops numbered per tech with real road paths, like the Day view.

type RangeStop = DispatchStop & { startMin: number | null; endMin: number | null; locked: boolean }

interface Props {
  view: 'week' | 'month'
  date: string
  team: string[]
  settings: DispatchSettings
  filters: { groups: string[]; hideZero: boolean }
  userName: (id: string) => string
  laneColor: (id: string) => string
  onOpenDay: (date: string) => void
}

const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()
/** Monday on or before `d`. */
const weekStart = (d: string) => addDays(d, -((weekday(d) + 6) % 7))
const dayNum = (d: string) => Number(d.slice(8, 10))
const label = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
const MONTH_CHIPS = 6
const LS_SPLIT = 'lynxedo-dispatch-month-split'
const LS_WEEKMAP = 'lynxedo-dispatch-week-map-h'
const readNum = (k: string, d: number) => { try { const v = Number(localStorage.getItem(k)); return Number.isFinite(v) && v > 0 ? v : d } catch { return d } }
const writeNum = (k: string, v: number) => { try { localStorage.setItem(k, String(Math.round(v))) } catch {} }

export default function DispatchCalendar({ view, date, team, settings, filters, userName, laneColor, onOpenDay }: Props) {
  const [days, setDays] = useState<Record<string, RangeStop[]>>({})
  const [depot, setDepot] = useState<LatLng | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [coords, setCoords] = useState<Record<string, LatLng | null>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandAll, setExpandAll] = useState(false)
  const [mapDay, setMapDay] = useState<string | null>(null)
  const [legs, setLegs] = useState<DispatchMapLeg[]>([])
  // Resizable panes (Ben, Oct 2026): Month = calendar | map side by side with a
  // draggable divider; Week = calendar over map with a draggable height.
  const [split, setSplit] = useState(62)          // calendar width %, Month
  const [weekMapH, setWeekMapH] = useState(520)   // map height px, Week
  useEffect(() => { setSplit(readNum(LS_SPLIT, 62)); setWeekMapH(readNum(LS_WEEKMAP, 520)) }, [])
  const rowRef = useRef<HTMLDivElement>(null)

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
    setLoading(true); setError(null); setMapDay(null); setExpanded(new Set())
    fetch(`/api/hub/routing/dispatch/range?from=${from}&to=${to}&techIds=${encodeURIComponent(teamKey)}`)
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return
        if (!ok) throw new Error(d.error || 'Could not load')
        setDays(d.days ?? {})
        setDepot(d.depot ?? null)
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [from, to, teamKey])

  // Geocode every address in range (server geocoder + cache, same as the optimizer).
  useEffect(() => {
    const want = [...new Set(Object.values(days).flat().map(s => s.address).filter(a => a && !(a in coords)))]
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
  }, [days])

  const dim = (s: DispatchStop) => {
    if (filters.hideZero && Math.abs(s.totalPrice) < 0.005) return true
    const active = settings.filter_groups.filter(g => filters.groups.includes(g.id))
    return active.length > 0 && !active.some(g => stopMatchesGroup(s, g))
  }
  const today = todayLocal()
  const viewStart = hhmmToMinutes(settings.view_start)
  const span = Math.max(60, hhmmToMinutes(settings.view_end) - viewStart)
  const isOpen = (key: string) => expandAll || expanded.has(key)
  const toggle = (key: string) => setExpanded(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })

  // ── Map ───────────────────────────────────────────────────────────────────
  const inRange = (d: string) => (view === 'month' ? d.slice(0, 7) === date.slice(0, 7) : true)
  const dayRoutes = useMemo(() => {
    if (!mapDay) return []
    return team.map(t => {
      const list = (days[mapDay] ?? []).filter(s => s.techIds.includes(t))
      const timed = list.filter(s => s.startMin != null).sort((a, b) => a.startMin! - b.startMin!)
      const anytime = list.filter(s => s.startMin == null)
      return { techId: t, timed, anytime }
    })
  }, [mapDay, days, team])

  const mapStops: DispatchMapStop[] = useMemo(() => {
    const out: DispatchMapStop[] = []
    const push = (s: RangeStop, techId: string, labelText: string, meta: string) => {
      const c = coords[s.address]
      if (!c) return
      out.push({
        id: `${s.id}|${techId}`, lat: c.lat, lng: c.lng, label: labelText, color: laneColor(techId),
        fill: dim(s) ? '#94a3b8' : stopColor(s, settings.color_rules, s.locked), locked: s.locked,
        title: s.clientName, subtitle: s.address, meta,
      })
    }
    if (mapDay) {
      for (const r of dayRoutes) {
        r.timed.forEach((s, i) => push(s, r.techId, String(i + 1), `${userName(r.techId)} · ${fmtClock(s.startMin!)}`))
        r.anytime.forEach(s => push(s, r.techId, '', `${userName(r.techId)} · anytime`))
      }
    } else {
      for (const [d, list] of Object.entries(days)) {
        if (!inRange(d)) continue
        for (const s of list) {
          const t = team.find(x => s.techIds.includes(x)) ?? s.techIds[0]
          push(s, t, '', `${label(d, { weekday: 'short', month: 'short', day: 'numeric' })} · ${userName(t)}${s.startMin != null ? ` · ${fmtClock(s.startMin)}` : ''}`)
        }
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapDay, dayRoutes, days, coords, settings.color_rules, filters, team])

  // Road legs only for the one day being mapped (shop → stops in time order → shop).
  const legKey = useMemo(() => dayRoutes.map(r => `${r.techId}:${r.timed.map(s => s.address).join(';')}`).join('|') + `|${coords ? Object.keys(coords).length : 0}`, [dayRoutes, coords])
  useEffect(() => {
    if (!mapDay) { setLegs([]); return }
    let cancelled = false
    ;(async () => {
      const out: DispatchMapLeg[] = []
      for (const r of dayRoutes) {
        const pts = r.timed.map(s => coords[s.address]).filter((c): c is LatLng => !!c)
        if (pts.length === 0) continue
        const path = [...(depot ? [depot] : []), ...pts, ...(depot ? [depot] : [])]
        for (let i = 0; i < path.length - 1; i++) {
          const leg = await fetchLeg(path[i], path[i + 1])
          const isReturn = !!depot && i === path.length - 2
          out.push({
            coords: leg.coords, color: laneColor(r.techId), isReturn,
            label: isReturn ? `back to shop · ${leg.minutes} min` : '',
            tooltip: `${userName(r.techId)} · ${leg.minutes} min · ${leg.miles} mi${leg.estimated ? ' (estimate)' : ''}`,
          })
        }
      }
      if (!cancelled) setLegs(out)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legKey, mapDay, depot])

  const depots = useMemo(() => (depot ? [{ ...depot, label: 'Shop' }] : []), [depot])
  const noop = () => {}

  if (team.length === 0) return null

  const mapBtn = (d: string) => (
    <span role="button" tabIndex={0} title="Show this day on the map"
      onClick={e => { e.stopPropagation(); setMapDay(m => (m === d ? null : d)) }}
      onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setMapDay(m => (m === d ? null : d)) } }}
      className={`ml-1 px-1 rounded text-[10px] cursor-pointer ${mapDay === d ? 'bg-orange-500 text-[#fff]' : 'text-gray-500 hover:text-white'}`}>🗺</span>
  )

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
        <span className="text-[11px] text-gray-500">From Hub&apos;s copy of Jobber (visits only) · click a day to open it</span>
      </div>

      {view === 'week' ? (
        <div className="min-w-[760px] grid" style={{ gridTemplateColumns: `8rem repeat(7, minmax(0, 1fr))` }}>
          <div />
          {cells.map(d => (
            <div key={d} className="flex items-center justify-center">
              <button type="button" onClick={() => onOpenDay(d)}
                className={`text-xs py-1 px-1 rounded hover:bg-gray-800 ${d === today ? 'text-orange-400 font-semibold' : 'text-gray-400'}`}>
                {label(d, { weekday: 'short', month: 'numeric', day: 'numeric' })}
              </button>
              {mapBtn(d)}
            </div>
          ))}
          {team.map(t => (
            <WeekRow key={t} techId={t} cells={cells} days={days} name={userName(t)} color={laneColor(t)}
              settings={settings} dim={dim} viewStart={viewStart} span={span} onOpenDay={onOpenDay}
              isOpen={isOpen} toggle={toggle} />
          ))}
        </div>
      ) : (
        <div className="min-w-[640px] grid grid-cols-7 gap-px bg-gray-800 rounded-lg overflow-hidden">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => <div key={w} className="bg-gray-900 text-xs font-medium text-gray-400 text-center py-1.5">{w}</div>)}
          {cells.map(d => {
            const list = (days[d] ?? []).filter(s => !dim(s))
              .sort((a, b) => (a.startMin ?? 9999) - (b.startMin ?? 9999))
            const inMonth = d.slice(0, 7) === date.slice(0, 7)
            const open = isOpen(d)
            const shown = open ? list : list.slice(0, MONTH_CHIPS)
            return (
              <div key={d} role="button" tabIndex={0} onClick={() => onOpenDay(d)} onKeyDown={e => { if (e.key === 'Enter') onOpenDay(d) }}
                className={`bg-gray-900 hover:bg-gray-800/70 text-left p-1.5 cursor-pointer min-h-[150px] min-w-0 ${inMonth ? '' : 'opacity-40'} ${mapDay === d ? 'ring-1 ring-orange-500 ring-inset' : ''}`}>
                <div className="flex items-center text-sm mb-1">
                  <span className={d === today ? 'text-orange-400 font-bold' : 'text-gray-300 font-medium'}>{dayNum(d)}</span>
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
                {shown.map(s => (
                  // Full visit title, wrapping, like Jobber — Heroes' titles carry
                  // the client, program, area and any promise.
                  <div key={s.id} className="text-[12px] leading-snug mt-1 px-1.5 py-0.5 rounded text-[#fff] break-words" style={{ background: stopColor(s, settings.color_rules, s.locked), opacity: s.isComplete ? 0.7 : 1 }}
                    title={`${s.clientName}${s.locked ? ' · promised' : ''}`}>
                    {s.isComplete ? '✓ ' : ''}{s.startMin != null && <b>{fmtClock(s.startMin)} </b>}{s.title || s.clientName}{s.locked ? ' 🔒' : ''}
                  </div>
                ))}
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
          ? <>Map: <b className="text-white">{label(mapDay, { weekday: 'long', month: 'short', day: 'numeric' })}</b> — numbered by time, real road paths
              <button type="button" onClick={() => setMapDay(null)} className="ml-auto text-gray-400 hover:text-white">Show the whole {view}</button></>
          : <>Map: every visit this {view} · 🗺 on a day shows just that day&apos;s routes</>}
      </div>
      <DispatchMap depots={depots} stops={mapStops} legs={mapDay ? legs : []} unscheduled={[]} highlightId={null} onStopClick={noop}
        height={view === 'week' ? `${weekMapH}px` : 'max(520px, calc(100vh - 140px))'} />
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

function WeekRow({ techId, cells, days, name, color, settings, dim, viewStart, span, onOpenDay, isOpen, toggle }: {
  techId: string; cells: string[]; days: Record<string, RangeStop[]>; name: string; color: string
  settings: DispatchSettings; dim: (s: DispatchStop) => boolean; viewStart: number; span: number; onOpenDay: (d: string) => void
  isOpen: (key: string) => boolean; toggle: (key: string) => void
}) {
  return (
    <>
      <div className="flex items-center gap-1.5 text-sm font-medium py-2 border-t border-gray-800 pr-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
        <span className="truncate">{name}</span>
      </div>
      {cells.map(d => {
        const list = (days[d] ?? []).filter(s => s.techIds.includes(techId)).sort((a, b) => (a.startMin ?? 9999) - (b.startMin ?? 9999))
        const timed = list.filter(s => s.startMin != null)
        const anytime = list.length - timed.length
        const key = `${d}|${techId}`
        const open = isOpen(key)
        return (
          <div key={d} role="button" tabIndex={0} onClick={() => onOpenDay(d)} onKeyDown={e => { if (e.key === 'Enter') onOpenDay(d) }}
            className="border-t border-l border-gray-800 p-1 hover:bg-gray-800/60 text-left cursor-pointer min-w-0">
            <div className="relative h-6 rounded bg-gray-950/60 overflow-hidden">
              {timed.map(s => (
                <div key={s.id} className="absolute top-0.5 bottom-0.5 rounded-sm"
                  title={`${fmtClock(s.startMin!)} ${s.clientName}${s.locked ? ' · promised' : ''}`}
                  style={{
                    left: `${Math.max(0, ((s.startMin! - viewStart) / span) * 100)}%`,
                    width: `${Math.max(3, (((s.endMin ?? s.startMin! + 30) - s.startMin!) / span) * 100)}%`,
                    background: stopColor(s, settings.color_rules, s.locked),
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
                {list.map(s => (
                  <div key={s.id} className="text-[12px] leading-snug px-1.5 py-0.5 rounded text-[#fff] break-words" style={{ background: stopColor(s, settings.color_rules, s.locked), opacity: dim(s) ? 0.35 : 1 }}>
                    {s.startMin != null ? <b>{fmtClock(s.startMin)} </b> : 'Anytime · '}{s.title || s.clientName}{s.locked ? ' 🔒' : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
