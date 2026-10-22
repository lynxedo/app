'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtClock } from '@/lib/dispatch'

// The route panel for one day — Day view (side column) and the 🗺 day in
// Week/Month. Brings the Advanced optimizer's controls to Dispatch (Ben,
// Oct 20 2026):
//  • tick which stops to optimize (all by default) — optimize a subset;
//  • 📌 1st / 📌 Last pins a lane's first or last stop before optimizing;
//  • days since each stop's last completed visit;
//  • stops that couldn't be put on the map, listed plainly.
// Pins and ticks are remembered per day in this browser.
//
// ⚡ Optimize on a selection (Ctrl/⌘-click or the map's Lasso) talks to this
// panel through window events (the panel owns the ticks): 'lynxedo-dispatch-lasso' {date, ids, mode} in, and
// 'lynxedo-dispatch-ticks' {date, off} out so the map can fade unticked stops.
// The first "tick" loop when everything is ticked means "just these".

export const LASSO_EVENT = 'lynxedo-dispatch-lasso'
export const TICKS_EVENT = 'lynxedo-dispatch-ticks'
/** Saved unticked ids for a day (for the map's fade before the panel has announced). */
export function readPanelOff(date: string): string[] {
  try { const v = localStorage.getItem(`lynxedo-dispatch-route-panel:${date}`); if (v) return (JSON.parse(v).off ?? []) as string[] } catch {}
  return []
}
/** 'only' = tick exactly these and untick the rest (⚡ Optimize from a selection). */
export function sendLasso(date: string, ids: string[], mode: 'select' | 'deselect' | 'only') {
  window.dispatchEvent(new CustomEvent(LASSO_EVENT, { detail: { date, ids, mode } }))
}

export interface PanelStop {
  id: string
  clientName: string
  title: string
  startMin: number | null
  mapped: boolean      // has coordinates
  routable: boolean    // has an address at all
  locked: boolean
  isComplete: boolean
  changed: boolean
}
export interface PanelLane { techId: string; name: string; color: string; stops: PanelStop[] }

export interface OptimizeRequest {
  lanes: Array<{ techId: string; stopIds: string[]; firstId: string | null; lastId: string | null }>
}

interface Saved { off: string[]; pins: Record<string, { first: string | null; last: string | null }> }

const key = (date: string) => `lynxedo-dispatch-route-panel:${date}`
const read = (date: string): Saved => {
  try { const v = localStorage.getItem(key(date)); if (v) return JSON.parse(v) as Saved } catch {}
  return { off: [], pins: {} }
}

export default function DispatchRoutePanel({ date, lanes, busy, onOptimize, onClose }: {
  date: string
  lanes: PanelLane[]
  busy: boolean
  onOptimize: (req: OptimizeRequest) => void
  onClose?: () => void
}) {
  const [saved, setSaved] = useState<Saved>({ off: [], pins: {} })
  const [days, setDays] = useState<Record<string, number | null>>({})
  const [open, setOpen] = useState(true)
  const announce = (d: string, off: string[]) => window.dispatchEvent(new CustomEvent(TICKS_EVENT, { detail: { date: d, off } }))
  useEffect(() => { const v = read(date); setSaved(v); announce(date, v.off) }, [date])
  const save = (n: Saved) => { setSaved(n); try { localStorage.setItem(key(date), JSON.stringify(n)) } catch {}; announce(date, n.off) }

  const allIds = useMemo(() => lanes.flatMap(l => l.stops.map(s => s.id)), [lanes])
  const idsKey = allIds.join(',')

  // Lasso from the map.
  const savedRef = useRef(saved)
  useEffect(() => { savedRef.current = saved })
  const allRef = useRef(allIds)
  useEffect(() => { allRef.current = allIds })
  useEffect(() => {
    const onLasso = (e: Event) => {
      const d = (e as CustomEvent<{ date: string; ids: string[]; mode: 'select' | 'deselect' | 'only' }>).detail
      if (!d || d.date !== date) return
      const cur = savedRef.current
      const hit = new Set(d.ids)
      let off: string[]
      if (d.mode === 'deselect') off = [...new Set([...cur.off, ...d.ids])]
      else if (d.mode === 'only') off = allRef.current.filter(id => !hit.has(id))
      else if (cur.off.length === 0) off = allRef.current.filter(id => !hit.has(id))   // first loop = just these
      else off = cur.off.filter(id => !hit.has(id))
      const n = { ...cur, off }
      setSaved(n)
      try { localStorage.setItem(key(date), JSON.stringify(n)) } catch {}
      window.dispatchEvent(new CustomEvent(TICKS_EVENT, { detail: { date, off } }))
      setOpen(true)
    }
    window.addEventListener(LASSO_EVENT, onLasso)
    return () => window.removeEventListener(LASSO_EVENT, onLasso)
  }, [date])
  useEffect(() => {
    if (!idsKey) return
    let cancelled = false
    fetch('/api/hub/routing/dispatch/last-visits', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitIds: idsKey.split(',') }),
    }).then(r => r.json()).then(d => { if (!cancelled) setDays(d.days ?? {}) }).catch(() => {})
    return () => { cancelled = true }
  }, [idsKey])

  const off = new Set(saved.off)
  const toggle = (id: string) => save({ ...saved, off: off.has(id) ? saved.off.filter(x => x !== id) : [...saved.off, id] })
  const setAll = (lane: PanelLane, on: boolean) => {
    const ids = lane.stops.map(s => s.id)
    save({ ...saved, off: on ? saved.off.filter(x => !ids.includes(x)) : [...new Set([...saved.off, ...ids])] })
  }
  const pin = (techId: string, which: 'first' | 'last', id: string) => {
    const cur = saved.pins[techId] ?? { first: null, last: null }
    const next = { ...cur, [which]: cur[which] === id ? null : id }
    if (which === 'first' && next.last === id) next.last = null
    if (which === 'last' && next.first === id) next.first = null
    save({ ...saved, pins: { ...saved.pins, [techId]: next } })
  }

  const unmapped = lanes.flatMap(l => l.stops.filter(s => !s.mapped).map(s => ({ s, l })))
  const req: OptimizeRequest = {
    lanes: lanes.map(l => {
      const stopIds = l.stops.filter(s => s.mapped && !s.isComplete && !off.has(s.id)).map(s => s.id)
      const p = saved.pins[l.techId] ?? { first: null, last: null }
      return {
        techId: l.techId, stopIds,
        firstId: p.first && stopIds.includes(p.first) ? p.first : null,
        lastId: p.last && stopIds.includes(p.last) ? p.last : null,
      }
    }).filter(l => l.stopIds.length > 0),
  }
  const count = req.lanes.reduce((n, l) => n + l.stopIds.length, 0)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-sm">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen(o => !o)} className="font-semibold text-sm hover:text-orange-300">
          {open ? '▾' : '▸'} Route &amp; optimize
        </button>
        <span className="text-xs text-gray-500">{new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
        {onClose && <button type="button" onClick={onClose} className="ml-auto text-gray-500 hover:text-white" aria-label="Close">✕</button>}
      </div>
      {open && (
        <div className="mt-2 space-y-3">
          {lanes.map(l => {
            const p = saved.pins[l.techId] ?? { first: null, last: null }
            return (
              <div key={l.techId}>
                <div className="flex items-center gap-1.5 text-xs font-medium mb-1">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: l.color }} />
                  <span>{l.name}</span>
                  <span className="text-gray-500">{l.stops.length} stop{l.stops.length === 1 ? '' : 's'}</span>
                  <button type="button" onClick={() => setAll(l, true)} className="ml-auto text-gray-400 hover:text-white">All</button>
                  <button type="button" onClick={() => setAll(l, false)} className="text-gray-400 hover:text-white">None</button>
                </div>
                {l.stops.length === 0 && <div className="text-xs text-gray-600">No stops.</div>}
                {l.stops.map((s, i) => {
                  const d = days[s.id]
                  return (
                    <div key={s.id} className={`flex items-center gap-1.5 py-0.5 text-xs ${s.isComplete ? 'opacity-50' : ''}`}>
                      <input type="checkbox" disabled={!s.mapped || s.isComplete} checked={s.mapped && !s.isComplete && !off.has(s.id)} onChange={() => toggle(s.id)}
                        title="Include in Optimize" />
                      <span className="w-5 text-right text-gray-500">{s.mapped ? i + 1 : ''}</span>
                      <span className={`flex-1 min-w-0 truncate ${s.changed ? 'text-orange-300' : ''}`} title={s.title}>
                        {s.clientName}{s.locked ? ' 🔒' : ''}
                      </span>
                      <span className="text-gray-500 shrink-0">{s.startMin != null ? fmtClock(s.startMin) : 'anytime'}</span>
                      {d != null && <span className="shrink-0 text-[10px] px-1 rounded bg-gray-800 text-gray-300" title="Days since the last completed visit">{d}d</span>}
                      {s.mapped && !s.isComplete && (
                        <>
                          <button type="button" onClick={() => pin(l.techId, 'first', s.id)} title="Always first"
                            className={`shrink-0 px-1 rounded text-[10px] ${p.first === s.id ? 'bg-orange-500 text-[#fff]' : 'text-gray-500 hover:text-white'}`}>📌1st</button>
                          <button type="button" onClick={() => pin(l.techId, 'last', s.id)} title="Always last"
                            className={`shrink-0 px-1 rounded text-[10px] ${p.last === s.id ? 'bg-orange-500 text-[#fff]' : 'text-gray-500 hover:text-white'}`}>📌Last</button>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
          {unmapped.length > 0 && (
            <div className="rounded-lg border border-red-800 bg-red-900/20 p-2 text-xs text-red-300">
              <div className="font-medium mb-0.5">Couldn&apos;t be put on the map ({unmapped.length})</div>
              {unmapped.map(({ s, l }) => (
                <div key={s.id}>{s.clientName} <span className="text-red-400/70">· {l.name}{s.routable ? ' · address not found' : ' · no address'}</span></div>
              ))}
              <div className="text-red-400/70 mt-1">Fix the address in Jobber, then Refresh. These are left out of Optimize.</div>
            </div>
          )}
          <button type="button" onClick={() => onOptimize(req)} disabled={busy || count === 0}
            className="w-full px-3 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-[#fff] text-sm font-medium disabled:opacity-40">
            {busy ? 'Optimizing…' : `⚡ Optimize ${count} stop${count === 1 ? '' : 's'}`}
          </button>
          <p className="text-[10px] text-gray-500">Unticked stops keep their place. 📌 pins a tech&apos;s first or last stop. ◌ Lasso on the map ticks the stops you draw around. You&apos;ll see a preview before anything changes.</p>
        </div>
      )}
    </div>
  )
}
