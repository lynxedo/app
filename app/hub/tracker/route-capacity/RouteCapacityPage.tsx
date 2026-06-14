'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback, useMemo, memo } from 'react'
import {
  computeRouteCapacity,
  summarizeRouteCapacity,
  type RouteCapacityRow,
  type RouteCapacityFormulas,
} from '@/lib/route-capacity-formulas'
import { compareValues, cycleSort, type SortState } from '@/lib/tracker-sort'
import { useToast } from '@/components/ui'

type ColKind = 'data' | 'formula'
type DataType = 'text' | 'date' | 'number'
type Fmt = 'money' | 'num' | 'hours'

type Col = {
  key: string
  label: string
  kind: ColKind
  type?: DataType
  width: number
  fmt?: Fmt
  footer?: 'count' | 'sum'
}

const COLS: Col[] = [
  { key: 'name', label: 'Job #', kind: 'data', type: 'text', width: 110, footer: 'count' },
  { key: 'sync_date', label: 'Sync Date', kind: 'data', type: 'date', width: 120 },
  { key: 'wfRoute', label: 'WF Route', kind: 'formula', width: 90 },
  { key: 'program', label: 'Program', kind: 'formula', width: 90 },
  { key: 'job_title', label: 'Job title', kind: 'data', type: 'text', width: 240 },
  { key: 'client_name', label: 'Client name', kind: 'data', type: 'text', width: 150 },
  { key: 'service_street', label: 'Service street', kind: 'data', type: 'text', width: 180 },
  { key: 'service_city', label: 'Service city', kind: 'data', type: 'text', width: 120 },
  { key: 'service_province', label: 'State', kind: 'data', type: 'text', width: 70 },
  { key: 'service_zip', label: 'ZIP', kind: 'data', type: 'text', width: 80 },
  { key: 'line_items', label: 'Line items', kind: 'data', type: 'text', width: 260 },
  { key: 'total', label: 'Total ($)', kind: 'data', type: 'number', width: 110, fmt: 'money', footer: 'sum' },
  { key: 'lawn_size', label: 'Lawn Size', kind: 'data', type: 'text', width: 110 },
  { key: 'size_helper', label: 'Size Helper', kind: 'data', type: 'text', width: 90 },
  { key: 'size', label: 'Size', kind: 'formula', width: 70, fmt: 'num' },
  { key: 'productionTime', label: 'Production Time', kind: 'formula', width: 110, fmt: 'hours', footer: 'sum' },
  { key: 'drive_time', label: 'Drive Time', kind: 'data', type: 'number', width: 100, fmt: 'hours', footer: 'sum' },
  { key: 'totalTime', label: 'Total Time', kind: 'formula', width: 100, fmt: 'hours', footer: 'sum' },
]

function sortValue(row: RouteCapacityRow, col: Col): unknown {
  if (col.kind === 'formula') {
    return (computeRouteCapacity(row) as unknown as Record<string, unknown>)[col.key]
  }
  return (row as unknown as Record<string, unknown>)[col.key]
}

function fmtMoney(n: number | null): string { return n == null ? '' : `$${Math.round(n).toLocaleString()}` }
function fmtNum(n: number | null): string { return n == null ? '' : `${Math.round(n * 100) / 100}` }
function fmtHours(n: number | null): string { return n == null ? '' : `${Math.round(n * 100) / 100}` }
function fmtBy(v: number | null, fmt?: Fmt): string {
  if (fmt === 'money') return fmtMoney(v)
  if (fmt === 'hours') return fmtHours(v)
  return fmtNum(v)
}

function DataCell({ row, col, onUpdate }: { row: RouteCapacityRow; col: Col; onUpdate: (field: string, value: unknown) => void }) {
  const raw = (row as unknown as Record<string, unknown>)[col.key]
  if (col.type === 'number') {
    return (
      <input
        type="number"
        defaultValue={raw == null ? '' : String(raw)}
        onBlur={e => { const v = e.target.value.trim(); onUpdate(col.key, v === '' ? null : parseFloat(v)) }}
        className="w-full bg-transparent text-white text-xs text-right px-1 py-1 rounded focus:bg-gray-800 focus:outline-none border border-transparent focus:border-gray-700"
      />
    )
  }
  if (col.type === 'date') {
    return (
      <input
        type="date"
        value={(raw as string) ?? ''}
        onChange={e => onUpdate(col.key, e.target.value || null)}
        className="w-full bg-transparent text-gray-200 text-xs px-1 py-1 rounded focus:bg-gray-800 focus:outline-none border border-transparent focus:border-gray-700"
      />
    )
  }
  return (
    <input
      type="text"
      defaultValue={(raw as string) ?? ''}
      onBlur={e => onUpdate(col.key, e.target.value.trim() || null)}
      className="w-full bg-transparent text-white text-xs px-1 py-1 rounded focus:bg-gray-800 focus:outline-none border border-transparent focus:border-gray-700"
    />
  )
}

// One table row, memoized (TR4). `update` preserves unedited rows' identity, so only
// the edited row re-renders and computeRouteCapacity() runs once for it instead of for
// the whole grid on every keystroke. onUpdate/onDelete must be stable (useCallback).
const RouteCapacityRowTr = memo(function RouteCapacityRowTr({
  row,
  onUpdate,
  onDelete,
}: {
  row: RouteCapacityRow
  onUpdate: (id: string, field: string, value: unknown) => void
  onDelete: (id: string) => void
}) {
  const f: RouteCapacityFormulas = computeRouteCapacity(row)
  return (
    <tr className="border-b border-gray-800/70 hover:bg-gray-900/40">
      {COLS.map(c => (
        <td key={c.key} className={`px-2 py-1 align-middle ${c.kind === 'formula' ? 'text-right text-xs text-gray-300 tabular-nums' : ''}`}>
          {c.kind === 'data'
            ? <DataCell row={row} col={c} onUpdate={(field, value) => onUpdate(row.id, field, value)} />
            : (c.fmt ? fmtBy((f as unknown as Record<string, number | null>)[c.key], c.fmt) : <span className="text-xs">{(f as unknown as Record<string, string>)[c.key]}</span>)}
        </td>
      ))}
      <td className="px-1 text-center">
        <button onClick={() => onDelete(row.id)} className="text-gray-600 hover:text-red-400 text-xs" title="Delete">✕</button>
      </td>
    </tr>
  )
})

export default function RouteCapacityPage() {
  const toast = useToast()
  const [rows, setRows] = useState<RouteCapacityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<SortState>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (search) p.set('search', search)
    const res = await fetch(`/api/tracker/route-capacity?${p.toString()}`)
    const data = res.ok ? await res.json() : []
    setRows(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [search])

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])

  const update = useCallback((id: string, field: string, value: unknown) => {
    // Optimistic update with rollback on a failed save (TR6).
    let prevValue: unknown
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r
      prevValue = (r as Record<string, unknown>)[field]
      return { ...r, [field]: value } as RouteCapacityRow
    }))
    fetch(`/api/tracker/route-capacity/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
      .then(res => { if (!res.ok) throw new Error(String(res.status)) })
      .catch(() => {
        setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: prevValue } as RouteCapacityRow : r))
        toast.error('Couldn’t save that change — it was reverted. Please try again.')
      })
  }, [toast])

  async function addRow() {
    const res = await fetch('/api/tracker/route-capacity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New', job_title: '' }),
    })
    if (res.ok) { const row = await res.json(); setRows(prev => [row, ...prev]) }
  }

  const deleteRow = useCallback(async (id: string) => {
    if (!confirm('Delete this row?')) return
    setRows(prev => prev.filter(r => r.id !== id))
    await fetch(`/api/tracker/route-capacity/${id}`, { method: 'DELETE' })
  }, [])

  const sortedRows = useMemo(() => {
    if (!sort) return rows
    const col = COLS.find(c => c.key === sort.key)
    if (!col) return rows
    return rows
      .map(r => ({ r, v: sortValue(r, col) }))
      .sort((a, b) => compareValues(a.v, b.v, sort.dir))
      .map(d => d.r)
  }, [rows, sort])

  const groupNames = Array.from(new Set(rows.map(r => r.monday_group || 'Jobs')))
  const grouped = groupNames
    .map(g => ({ name: g, rows: sortedRows.filter(r => (r.monday_group || 'Jobs') === g) }))
    .filter(g => g.rows.length > 0)

  const totalWidth = COLS.reduce((s, c) => s + c.width, 0) + 40

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="bg-gray-950 border-b border-gray-800">
          <div className="px-4 pt-2.5 pb-1.5 flex items-center gap-2 max-md:pl-14">
            <Link href="/hub/tracker" className="text-gray-500 hover:text-white text-sm transition-colors whitespace-nowrap" title="Back to Trackers">← Trackers</Link>
            <span className="text-gray-700">/</span>
            <h1 className="text-base font-semibold text-white">Route Capacity</h1>
          </div>
          <div className="px-4 pb-2.5 flex items-center gap-2 flex-wrap">
            <input
              type="text"
              placeholder="Search job #, title, client, city…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 min-w-48 max-w-xs bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
            <span className="text-xs text-gray-600 px-1">{rows.length} job{rows.length !== 1 ? 's' : ''}</span>
            <div className="flex-1" />
            <button onClick={addRow} className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap">+ New</button>
          </div>
        </div>

        {/* TR1 — this board is overwritten nightly by the Monday→Lynxedo mirror. */}
        <div className="px-4 py-1.5 text-xs text-amber-300/90 bg-amber-500/10 border-b border-amber-500/20 max-md:pl-14">
          🔄 Synced nightly from Monday — edit in Monday. Changes made here are overwritten on the next sync.
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-600 text-sm">Loading…</div>
        ) : (
          <div className="space-y-3 p-3" style={{ minWidth: totalWidth + 24 }}>
            {grouped.map(group => {
              const isCollapsed = collapsed.has(group.name)
              const summary = summarizeRouteCapacity(group.rows)
              return (
                <div key={group.name} className="rounded-lg overflow-hidden shadow-sm">
                  <div
                    onClick={() => setCollapsed(prev => { const n = new Set(prev); n.has(group.name) ? n.delete(group.name) : n.add(group.name); return n })}
                    className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:opacity-90 transition-opacity"
                    style={{ backgroundColor: '#0073ea' }}
                  >
                    <span className="text-sm font-semibold text-white">{group.name}</span>
                    <span className="text-white/70 text-xs">{group.rows.length}</span>
                    <span className="text-white/70 ml-auto text-xs">{isCollapsed ? '▸' : '▾'}</span>
                  </div>

                  {!isCollapsed && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left" style={{ minWidth: totalWidth, tableLayout: 'fixed' }}>
                        <colgroup>
                          {COLS.map(c => <col key={c.key} style={{ width: c.width }} />)}
                          <col style={{ width: 40 }} />
                        </colgroup>
                        <thead>
                          <tr className="bg-gray-900 border-b border-gray-800">
                            {COLS.map(c => (
                              <th
                                key={c.key}
                                onClick={() => setSort(s => cycleSort(s, c.key))}
                                title="Click to sort"
                                className={`px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 cursor-pointer select-none hover:text-gray-200 ${c.kind === 'formula' || c.fmt ? 'text-right' : ''}`}
                              >
                                <span className="inline-flex items-center gap-1">
                                  {c.label}
                                  {sort?.key === c.key && <span className="text-indigo-400">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                                </span>
                              </th>
                            ))}
                            <th className="px-1" />
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map(row => (
                            <RouteCapacityRowTr key={row.id} row={row} onUpdate={update} onDelete={deleteRow} />
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-gray-900 border-t border-gray-700 font-medium">
                            {COLS.map(c => {
                              let content = ''
                              if (c.footer === 'count') content = `${group.rows.length} total`
                              else if (c.footer === 'sum') {
                                if (c.key === 'total') content = fmtMoney(summary.total)
                                else if (c.key === 'productionTime') content = fmtHours(summary.productionTime)
                                else if (c.key === 'drive_time') content = fmtHours(summary.driveTime)
                                else if (c.key === 'totalTime') content = fmtHours(summary.totalTime)
                              }
                              return (
                                <td key={c.key} className={`px-2 py-2 text-xs text-gray-200 ${c.fmt || c.kind === 'formula' ? 'text-right tabular-nums' : ''}`}>
                                  {content}
                                </td>
                              )
                            })}
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
