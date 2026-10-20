'use client'

import { useEffect, useMemo, useState } from 'react'
import { computeRouteLoadout, fmtQty, type CapacityData, type RouteStopInput } from '@/lib/route-capacity'

// Tank loadout for one tech's day in Dispatch — the Advanced optimizer's panel,
// brought over (Ben, Oct 20 2026) and HIDDEN until opened so it never takes
// room when nobody is mixing. Same math (lib/route-capacity.ts): lawn size from
// the "K" in the title, products from Admin → Service Mapping, tanks from
// Admin → Routing. A tank picked per line item is saved per tech per day
// (route_tank_assignments, route_code "dispatch:<techId>") and rides along on
// the route sheet sent to Work Orders.

export const tankRouteCode = (techId: string) => `dispatch:${techId}`

export default function DispatchTankPanel({ date, techId, techName, stops, capacity, onLoadCapacity }: {
  date: string
  techId: string
  techName: string
  stops: RouteStopInput[]
  capacity: CapacityData | null
  onLoadCapacity: () => void
}) {
  const lsKey = `lynxedo-dispatch-tanks-open:${techId}`
  const [open, setOpen] = useState(false)
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map())
  useEffect(() => { try { setOpen(localStorage.getItem(lsKey) === '1') } catch {} }, [lsKey])
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem(lsKey, v ? '1' : '0') } catch {} }

  useEffect(() => { if (!capacity) onLoadCapacity() }, [capacity, onLoadCapacity])
  useEffect(() => {
    let cancelled = false
    fetch(`/api/hub/routing/tank-assignments?route_code=${encodeURIComponent(tankRouteCode(techId))}&run_date=${date}`)
      .then(r => r.json()).then(d => {
        if (cancelled) return
        setOverrides(new Map(Object.entries((d.assignments ?? {}) as Record<string, number>)))
      }).catch(() => {})
    return () => { cancelled = true }
  }, [techId, date])

  const loadout = useMemo(() => (capacity ? computeRouteLoadout(stops, capacity, overrides, date) : null), [stops, capacity, overrides, date])
  if (!capacity || !loadout || stops.length === 0) return null
  const tanks = capacity.tanks.filter(t => t.is_active).sort((a, b) => a.tank_number - b.tank_number)
  if (tanks.length === 0 && !loadout.hasMappings) return null

  const overflow = loadout.tanks.some(t => t.overflow)
  const byLineItem = new Map<string, typeof loadout.products>()
  for (const p of loadout.products) byLineItem.set(p.line_item, [...(byLineItem.get(p.line_item) ?? []), p])

  const setLineItemTank = async (lineItem: string, tank: number | null) => {
    const list = byLineItem.get(lineItem) ?? []
    const next = new Map(overrides)
    for (const p of list) { if (tank == null) next.delete(p.service_product_id); else next.set(p.service_product_id, tank) }
    setOverrides(next)
    await Promise.all(list.map(p => fetch('/api/hub/routing/tank-assignments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route_code: tankRouteCode(techId), run_date: date, service_product_id: p.service_product_id, tank_number: tank }),
    }).catch(() => {})))
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/40 text-xs">
      <button type="button" onClick={toggle} className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-gray-800/50 rounded-lg">
        <span>{open ? '▾' : '▸'} 🧪 Tanks · {techName}</span>
        <span className="text-gray-500">{Math.round(loadout.totalSqft).toLocaleString()} sq ft</span>
        {overflow && <span className="text-red-400">⚠ needs a refill</span>}
        {!loadout.hasMappings && <span className="text-gray-500">no product mappings yet</span>}
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-2">
          {loadout.tanks.map(t => (
            <div key={t.tank_number}>
              <div className="flex justify-between text-gray-400">
                <span>Tank {t.tank_number}{t.label ? ` · ${t.label}` : ''}{t.gallon_capacity ? ` · ${t.gallon_capacity} gal` : ''}</span>
                <span className={t.overflow ? 'text-red-400' : ''}>{t.fillPct != null ? `${Math.round(t.fillPct * 100)}%` : '—'}{t.overflow ? ' ⚠ needs a refill' : ''}</span>
              </div>
              <div className="h-2 rounded bg-gray-800 overflow-hidden">
                <div className={`h-full ${t.overflow ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, Math.round((t.fillPct ?? 0) * 100))}%` }} />
              </div>
            </div>
          ))}
          {[...byLineItem.entries()].map(([li, prods]) => {
            const cur = prods[0]?.tank ?? null
            return (
              <div key={li} className="border-t border-gray-800 pt-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-200 flex-1 truncate">{li}</span>
                  <select value={cur ?? ''} onChange={e => setLineItemTank(li, e.target.value ? Number(e.target.value) : null)}
                    className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5">
                    <option value="">No tank</option>
                    {tanks.map(t => <option key={t.tank_number} value={t.tank_number}>Tank {t.tank_number}</option>)}
                  </select>
                </div>
                {prods.map(p => (
                  <div key={p.service_product_id} className="flex justify-between text-gray-400 pl-2">
                    <span className="truncate">{p.name}</span>
                    <span>{fmtQty(p.quantity)} {p.unit}</span>
                  </div>
                ))}
              </div>
            )
          })}
          {loadout.stopsMissingSize.length > 0 && (
            <div className="text-amber-400">No lawn size in the title: {loadout.stopsMissingSize.join(', ')}</div>
          )}
          {loadout.unmappedLineItems.length > 0 && (
            <div className="text-gray-500">Not mapped to products: {loadout.unmappedLineItems.join(', ')} (Admin → Service Mapping)</div>
          )}
        </div>
      )}
    </div>
  )
}
