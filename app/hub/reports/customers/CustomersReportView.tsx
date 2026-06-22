'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown> & { cf: Record<string, string> }

type ColType = 'text' | 'number' | 'money' | 'bool' | 'date' | 'link'
type Col = { key: string; label: string; group: 'Customer' | 'Property' | 'Custom Fields'; type: ColType }

const LS_KEY = 'lynxedo-customer-report-cols'

// Static typed columns. Custom-field columns are appended at runtime.
const TYPED_COLS: Col[] = [
  // Customer
  { key: 'customer', label: 'Customer', group: 'Customer', type: 'text' },
  { key: 'first_name', label: 'First Name', group: 'Customer', type: 'text' },
  { key: 'last_name', label: 'Last Name', group: 'Customer', type: 'text' },
  { key: 'company_name', label: 'Company', group: 'Customer', type: 'text' },
  { key: 'status', label: 'Status', group: 'Customer', type: 'text' },
  { key: 'email', label: 'Email', group: 'Customer', type: 'text' },
  { key: 'phone', label: 'Phone', group: 'Customer', type: 'text' },
  { key: 'balance', label: 'Balance', group: 'Customer', type: 'money' },
  { key: 'lead_source', label: 'Lead Source', group: 'Customer', type: 'text' },
  { key: 'customer_since', label: 'Customer Since', group: 'Customer', type: 'text' },
  { key: 'sales_person', label: 'Sales Person', group: 'Customer', type: 'text' },
  { key: 'cancellation_reason', label: 'Cancellation Reason', group: 'Customer', type: 'text' },
  { key: 'client_created_at', label: 'Created (Jobber)', group: 'Customer', type: 'date' },
  { key: 'client_external_id', label: 'Jobber Client ID', group: 'Customer', type: 'text' },
  { key: 'client_web_uri', label: 'Jobber Link', group: 'Customer', type: 'link' },
  // Property
  { key: 'address', label: 'Address', group: 'Property', type: 'text' },
  { key: 'city', label: 'City', group: 'Property', type: 'text' },
  { key: 'state', label: 'State', group: 'Property', type: 'text' },
  { key: 'zip', label: 'Zip', group: 'Property', type: 'text' },
  { key: 'property_name', label: 'Property Name', group: 'Property', type: 'text' },
  { key: 'is_billing_address', label: 'Billing Address?', group: 'Property', type: 'bool' },
  { key: 'lawn_size_sqft', label: 'Lawn Size (sqft)', group: 'Property', type: 'number' },
  { key: 'lawn_size_k', label: 'Lawn Size (K)', group: 'Property', type: 'number' },
  { key: 'irrigation_zones', label: 'Irrigation Zones', group: 'Property', type: 'number' },
  { key: 'sprinkler_system', label: 'Sprinkler System?', group: 'Property', type: 'bool' },
  { key: 'gate_code', label: 'Gate Code', group: 'Property', type: 'text' },
  { key: 'neighborhood', label: 'Neighborhood', group: 'Property', type: 'text' },
  { key: 'latitude', label: 'Latitude', group: 'Property', type: 'number' },
  { key: 'longitude', label: 'Longitude', group: 'Property', type: 'number' },
  { key: 'property_web_uri', label: 'Property Jobber Link', group: 'Property', type: 'link' },
]

const DEFAULT_VISIBLE = ['customer', 'address', 'city', 'lawn_size_sqft', 'status', 'phone']

// ── Value helpers ────────────────────────────────────────────────────────────

function rawValue(row: Row, col: Col): unknown {
  if (col.key.startsWith('cf:')) return row.cf?.[col.key.slice(3)] ?? ''
  return row[col.key]
}

function display(row: Row, col: Col): string {
  const v = rawValue(row, col)
  if (v == null || v === '') return ''
  switch (col.type) {
    case 'money': {
      const n = Number(v)
      return isNaN(n) ? '' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
    case 'number': {
      const n = Number(v)
      return isNaN(n) ? '' : n.toLocaleString('en-US')
    }
    case 'bool':
      return v ? 'Yes' : 'No'
    case 'date': {
      const d = new Date(String(v))
      return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    }
    default:
      return String(v)
  }
}

function sortValue(row: Row, col: Col): string | number {
  const v = rawValue(row, col)
  if (v == null || v === '') return col.type === 'number' || col.type === 'money' ? -Infinity : ''
  if (col.type === 'number' || col.type === 'money') { const n = Number(v); return isNaN(n) ? -Infinity : n }
  if (col.type === 'bool') return v ? 1 : 0
  if (col.type === 'date') { const t = new Date(String(v)).getTime(); return isNaN(t) ? -Infinity : t }
  return String(v).toLowerCase()
}

const STATUS_FILTERS = ['All', 'Active', 'Lead', 'Cancelled', 'Archived'] as const
type StatusFilter = typeof STATUS_FILTERS[number]

// ── Component ────────────────────────────────────────────────────────────────

export default function CustomersReportView() {
  const [rows, setRows] = useState<Row[]>([])
  const [cfLabels, setCfLabels] = useState<string[]>([])
  const [counts, setCounts] = useState<{ clients: number; properties: number; rows: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [visible, setVisible] = useState<string[]>(DEFAULT_VISIBLE)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All')
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'customer', dir: 'asc' })
  const [showPicker, setShowPicker] = useState(false)

  // Restore saved column selection.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY)
      if (saved) { const arr = JSON.parse(saved); if (Array.isArray(arr) && arr.length) setVisible(arr) }
    } catch { /* ignore */ }
  }, [])

  const persistVisible = useCallback((next: string[]) => {
    setVisible(next)
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/hub/reports/customers')
      .then(async (r) => { if (!r.ok) throw new Error((await r.json()).error || 'Failed to load'); return r.json() })
      .then((data) => {
        if (cancelled) return
        setRows(data.rows ?? [])
        setCfLabels(data.customFieldLabels ?? [])
        setCounts(data.counts ?? null)
        setError(null)
      })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Full column catalog = typed + one column per discovered custom field.
  const allCols = useMemo<Col[]>(() => {
    const cf: Col[] = cfLabels.map((l) => ({ key: `cf:${l}`, label: l, group: 'Custom Fields' as const, type: 'text' as const }))
    return [...TYPED_COLS, ...cf]
  }, [cfLabels])

  const colByKey = useMemo(() => new Map(allCols.map((c) => [c.key, c])), [allCols])
  const visibleCols = useMemo(() => visible.map((k) => colByKey.get(k)).filter(Boolean) as Col[], [visible, colByKey])

  // Filter → sort.
  const view = useMemo(() => {
    const q = search.trim().toLowerCase()
    let out = rows
    if (statusFilter !== 'All') out = out.filter((r) => r.status === statusFilter)
    if (q) {
      out = out.filter((r) =>
        [r.customer, r.address, r.email, r.phone, r.neighborhood, r.city]
          .some((f) => f != null && String(f).toLowerCase().includes(q)))
    }
    const col = colByKey.get(sort.key)
    if (col) {
      const dir = sort.dir === 'asc' ? 1 : -1
      out = [...out].sort((a, b) => {
        const av = sortValue(a, col), bv = sortValue(b, col)
        if (av < bv) return -1 * dir
        if (av > bv) return 1 * dir
        return 0
      })
    }
    return out
  }, [rows, search, statusFilter, sort, colByKey])

  const toggleCol = (key: string) => {
    persistVisible(visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key])
  }

  const clickHeader = (key: string) => {
    setSort((s) => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }

  const exportCsv = () => {
    const esc = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    const header = visibleCols.map((c) => esc(c.label)).join(',')
    const lines = view.map((r) => visibleCols.map((c) => esc(display(r, c))).join(','))
    const csv = [header, ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `customer-report-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Header */}
      <div className="flex-none border-b border-white/10 px-4 py-3 flex items-center justify-between gap-3 max-md:pl-14">
        <div>
          <h1 className="text-lg font-semibold">Customer Report</h1>
          <p className="text-sm text-white/50">
            {counts ? `${counts.rows.toLocaleString()} rows · ${counts.clients.toLocaleString()} customers · ${counts.properties.toLocaleString()} properties` : 'Customers & properties from Jobber'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowPicker(true)}
            className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-sm border border-white/20">
            Columns ({visible.length})
          </button>
          <button onClick={exportCsv} disabled={!view.length}
            className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-[#fff] text-sm disabled:opacity-40">
            Export CSV
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex-none border-b border-white/10 px-4 py-2.5 flex flex-wrap items-center gap-2">
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, address, email, phone…"
          className="flex-1 min-w-[200px] bg-white/10 text-white rounded px-3 py-1.5 text-base md:text-sm border border-white/20 placeholder:text-white/30"
        />
        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded text-xs ${statusFilter === s ? 'bg-indigo-600 text-[#fff]' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-white/40">Loading…</div>
      ) : error ? (
        <div className="m-4 p-3 rounded bg-red-500/15 text-[var(--t-tint-danger)] text-sm">{error}</div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-900">
                {visibleCols.map((c) => (
                  <th key={c.key} onClick={() => clickHeader(c.key)}
                    className="text-left font-semibold text-white/60 px-3 py-2 whitespace-nowrap border-b border-white/10 cursor-pointer hover:text-white select-none">
                    {c.label}
                    {sort.key === c.key && <span className="text-[var(--t-tint-link)] ml-1">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                ))}
                {!visibleCols.length && <th className="px-3 py-2 text-white/40">Pick columns →</th>}
              </tr>
            </thead>
            <tbody>
              {view.map((r, i) => (
                <tr key={(r.client_id as string) + ':' + (r.property_id as string ?? i)} className="hover:bg-white/5">
                  {visibleCols.map((c) => {
                    const text = display(r, c)
                    if (c.type === 'link') {
                      const href = String(rawValue(r, c) || '')
                      return (
                        <td key={c.key} className="px-3 py-1.5 whitespace-nowrap border-b border-white/5">
                          {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--t-tint-link)] hover:underline">Open ↗</a> : <span className="text-white/20">—</span>}
                        </td>
                      )
                    }
                    return (
                      <td key={c.key} className={`px-3 py-1.5 whitespace-nowrap border-b border-white/5 ${c.type === 'money' || c.type === 'number' ? 'text-right tabular-nums' : ''}`}>
                        {text || <span className="text-white/20">—</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {!view.length && (
                <tr><td colSpan={Math.max(1, visibleCols.length)} className="px-3 py-10 text-center text-white/40">No customers match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Column picker */}
      {showPicker && (
        <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center bg-black/60 p-0 md:p-4" onClick={() => setShowPicker(false)}>
          <div className="bg-gray-900 w-full md:max-w-2xl md:rounded-xl border border-white/10 flex flex-col max-h-full md:max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex-none flex items-center justify-between px-4 py-3 border-b border-white/10">
              <h2 className="font-semibold">Choose Columns</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => persistVisible(DEFAULT_VISIBLE)} className="text-xs text-white/50 hover:text-white">Reset</button>
                <button onClick={() => setShowPicker(false)} className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-[#fff] text-sm">Done</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {(['Customer', 'Property', 'Custom Fields'] as const).map((group) => {
                const cols = allCols.filter((c) => c.group === group)
                if (!cols.length) return null
                return (
                  <div key={group}>
                    <div className="text-xs font-semibold text-[var(--t-tint-warning)] uppercase tracking-wider mb-1.5">{group}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                      {cols.map((c) => (
                        <label key={c.key} className="flex items-center gap-2 py-0.5 cursor-pointer text-sm hover:text-white text-white/80">
                          <input type="checkbox" checked={visible.includes(c.key)} onChange={() => toggleCol(c.key)} className="accent-indigo-500" />
                          <span className="truncate">{c.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
