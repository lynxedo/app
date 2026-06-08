'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { computeFormulas, summarize, type RecurringRow, type RecurringFormulas } from '@/lib/recurring-formulas'
import { compareValues, cycleSort, type SortState } from '@/lib/tracker-sort'

// ---- Option lists (mirrored exactly from Monday board 18188676554) ----
const SERVICE_OPTIONS = ['IRR Install', 'WF - Lawn Health', 'Pet Waste', 'Other', 'Landscape', 'IRR', 'IRR SC', 'Winterize', 'Spam/Sales', 'Drain', 'Aeration', 'Mow', 'MOS', 'phc', 'Upgrade', 'IR- Gold']
const LEAD_SOURCE_OPTIONS = ['Truck wrap', 'BS Marketing Day', 'Door Hanging', 'Angi Ads', 'Thumbtack', 'Networx', 'GLSA', 'Angi Lead', 'Networking- BNI', 'Networking-Other', 'Facebook', 'Organic', 'Website Visit', 'Paid Source', 'Google', 'Post Card 1/27', 'Existing Customer', 'Mailer', 'Neighbor Referral', 'NextDoor', 'Referral', 'LSS', 'Friends and Family', 'Upsell/Repeat Customer', 'Repeat Customer']
const STATUS_OPTIONS = ['New Lead', 'Follow Up', 'Sold', 'Sold- Upsell', 'Active', 'Unreachable', 'Bad Lead', 'Out of Service Area', 'Did Not Bid', 'Not Sold- Changed Mind', 'Not Sold- Other', 'Follow Up- Assessment Scheduled', 'Needs Bid', 'Follow Up - Long Term']
const SALESPERSON_OPTIONS = ['Ally', 'Ben', 'Mike', 'Bonnie', 'Angel', 'Kathryn', 'Lucas', 'SERV']
const BASE_PROGRAM_OPTIONS = ['WF - Root Rot Recovery', 'WF - Lawn Health Plus', 'WF - Lawn Health Basic', 'WF - Lawn Health Complete', 'PW - Pet Waste Removal Weekly', 'PW - Pet Waste Removal Biweekly', 'WF Organic Fertilizer Program', 'IR - Irrigation Service Plan Gold', 'MO - Mosquito Control', 'IR - Irrigation Service Plan Bronze', 'IR - Irrigation Service Plan Silver', 'MO - Mosquito Station Servicing', 'PW - Pet Waste Removal 2x Week', 'MO - Dunks', 'WF - Lawn Health Monthly', 'Special Reduced Plan', 'WF- Special Reduced Plan']
const AUX_OPTIONS = ['WF - Plant Health Care', 'WF - Bed Weed Prevention']
const CANCELLED_OPTIONS = ['Active', 'Downgraded', 'Upgraded', 'Cancelled']
const CANCELLATION_REASON_OPTIONS = ['Went to Competition - Results', 'Went to Competition - Price', 'Went to Competition - Other', 'Moved out of area', 'Moved in area', 'Death/Health', 'DIY', 'Results - RRR', 'Results - Other', 'TARR - Did not upgrade', 'Financial Reasons', 'Renovation', 'Unhappy with service', 'Office - Disputive Customer', 'Office - Other', 'Collections / Account Balance', 'not enough dogs', 'IR Plan did not renew', 'Will restart', 'Unknown']

const STATUS_COLORS: Record<string, string> = { 'New Lead': '#c4c4c4', 'Follow Up': '#ffcb00', 'Sold': '#00c875', 'Sold- Upsell': '#037f4c', 'Active': '#cab641', 'Unreachable': '#ff6d3b', 'Bad Lead': '#df2f4a', 'Out of Service Area': '#007eb5', 'Did Not Bid': '#9d50dd', 'Not Sold- Changed Mind': '#333333', 'Not Sold- Other': '#bb3354', 'Follow Up- Assessment Scheduled': '#175a63', 'Needs Bid': '#216edf', 'Follow Up - Long Term': '#fdab3d' }
const SALESPERSON_COLORS: Record<string, string> = { Ally: '#fdab3d', Ben: '#00c875', Mike: '#df2f4a', Bonnie: '#007eb5', Angel: '#9d50dd', Kathryn: '#579bfc', Lucas: '#cab641', SERV: '#ffcb00' }
const CANCELLED_COLORS: Record<string, string> = { Active: '#c4c4c4', Downgraded: '#fdab3d', Upgraded: '#00c875', Cancelled: '#df2f4a' }
const GROUP_COLORS: Record<string, string> = { Customers: '#0073ea', Upgraded: '#00c875' }

type ColKind = 'data' | 'formula'
type DataType = 'text' | 'longtext' | 'number' | 'date' | 'select' | 'color' | 'multi' | 'check'
type Fmt = 'money' | 'int' | 'pct'

type Col = {
  key: string
  label: string
  kind: ColKind
  type?: DataType
  options?: string[]
  colorMap?: Record<string, string>
  width: number
  fmt?: Fmt
  footer?: 'count' | 'sumAnnual' | 'summary'
}

const COLS: Col[] = [
  { key: 'name', label: 'Name', kind: 'data', type: 'text', width: 170, footer: 'count' },
  { key: 'phone', label: 'Phone', kind: 'data', type: 'text', width: 130 },
  { key: 'email', label: 'Email', kind: 'data', type: 'text', width: 190 },
  { key: 'lead_comments', label: 'Lead Comments', kind: 'data', type: 'longtext', width: 180 },
  { key: 'service', label: 'Service', kind: 'data', type: 'multi', options: SERVICE_OPTIONS, width: 150 },
  { key: 'lead_source', label: 'Lead Source', kind: 'data', type: 'select', options: LEAD_SOURCE_OPTIONS, width: 140 },
  { key: 'status', label: 'Status', kind: 'data', type: 'color', options: STATUS_OPTIONS, colorMap: STATUS_COLORS, width: 150 },
  { key: 'lead_creation_date', label: 'Lead Creation Date', kind: 'data', type: 'date', width: 130 },
  { key: 'sold_date', label: 'Sold Date', kind: 'data', type: 'date', width: 120 },
  { key: 'annual_value', label: 'Annual Value', kind: 'data', type: 'number', width: 110, footer: 'sumAnnual' },
  { key: 'salesperson', label: 'Salesperson', kind: 'data', type: 'color', options: SALESPERSON_OPTIONS, colorMap: SALESPERSON_COLORS, width: 120 },
  { key: 'base_program_sold', label: 'Base Program Sold', kind: 'data', type: 'select', options: BASE_PROGRAM_OPTIONS, width: 200 },
  { key: 'auxiliary_services', label: 'Auxiliary Services', kind: 'data', type: 'multi', options: AUX_OPTIONS, width: 180 },
  { key: 'cancelled_status', label: 'Cancelled?', kind: 'data', type: 'color', options: CANCELLED_OPTIONS, colorMap: CANCELLED_COLORS, width: 120 },
  { key: 'cancellation_reason', label: 'Cancellation Reason', kind: 'data', type: 'select', options: CANCELLATION_REASON_OPTIONS, width: 180 },
  { key: 'cancel_date', label: 'Cancel Date', kind: 'data', type: 'date', width: 120 },
  { key: 'temp_updated', label: 'Temp- Updated?', kind: 'data', type: 'check', width: 90 },
  { key: 'temp_prepaid', label: 'Temp- Prepaid?', kind: 'data', type: 'check', width: 90 },
  // ---- formula columns (read-only, full Monday parity) ----
  { key: 'aging', label: 'Aging', kind: 'formula', fmt: 'int', width: 80 },
  { key: 'daysToClose', label: 'Days to Close', kind: 'formula', fmt: 'int', width: 100 },
  { key: 'activeJobs', label: 'Active Jobs', kind: 'formula', fmt: 'int', width: 90, footer: 'summary' },
  { key: 'totalJobs', label: 'Total Jobs', kind: 'formula', fmt: 'int', width: 90, footer: 'summary' },
  { key: 'cancelledJobs', label: 'Cancelled Jobs', kind: 'formula', fmt: 'int', width: 100, footer: 'summary' },
  { key: 'retentionRate', label: 'Retention Rate', kind: 'formula', fmt: 'pct', width: 100, footer: 'summary' },
  { key: 'totalAnnualValue', label: 'Total Annual Value', kind: 'formula', fmt: 'money', width: 130, footer: 'summary' },
  { key: 'avJobValue', label: 'Av Job Value', kind: 'formula', fmt: 'money', width: 110 },
  { key: 'wfJobs', label: 'WF Jobs', kind: 'formula', fmt: 'int', width: 80, footer: 'summary' },
  { key: 'wfValue', label: 'WF Value', kind: 'formula', fmt: 'money', width: 110, footer: 'summary' },
  { key: 'wfAvValue', label: 'WF Av Value', kind: 'formula', fmt: 'money', width: 110 },
  { key: 'moJobs', label: 'MO Jobs', kind: 'formula', fmt: 'int', width: 80, footer: 'summary' },
  { key: 'moValue', label: 'MO Value', kind: 'formula', fmt: 'money', width: 110, footer: 'summary' },
  { key: 'irGold', label: 'IR Gold Customers', kind: 'formula', fmt: 'int', width: 110, footer: 'summary' },
  { key: 'irValue', label: 'IR Value', kind: 'formula', fmt: 'money', width: 110, footer: 'summary' },
  { key: 'pwCust', label: 'PW Cust', kind: 'formula', fmt: 'int', width: 80, footer: 'summary' },
  { key: 'pwValue', label: 'PW Value', kind: 'formula', fmt: 'money', width: 110, footer: 'summary' },
  { key: 'phc', label: 'PHC', kind: 'formula', fmt: 'int', width: 70, footer: 'summary' },
  { key: 'bwp', label: 'BWP', kind: 'formula', fmt: 'int', width: 70, footer: 'summary' },
  { key: 'auxServices', label: 'Aux Services', kind: 'formula', fmt: 'int', width: 90, footer: 'summary' },
  { key: 'phcPct', label: 'PHC %', kind: 'formula', fmt: 'pct', width: 80, footer: 'summary' },
  { key: 'bwpPct', label: 'BWP %', kind: 'formula', fmt: 'pct', width: 80, footer: 'summary' },
  { key: 'auxPct', label: 'Aux Service %', kind: 'formula', fmt: 'pct', width: 100, footer: 'summary' },
]

const GROUP_ORDER = ['Customers', 'Upgraded']

function lightText(hex: string): boolean {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160
}
function sortValue(row: RecurringRow, col: Col): unknown {
  if (col.kind === 'formula') {
    return (computeFormulas(row) as unknown as Record<string, unknown>)[col.key]
  }
  const raw = (row as unknown as Record<string, unknown>)[col.key]
  if (col.type === 'multi') return Array.isArray(raw) ? (raw as string[]).join(', ') : raw
  if (col.type === 'check') return raw ? 1 : 0
  return raw
}

function fmtMoney(n: number | null): string { return n == null ? '' : `$${Math.round(n).toLocaleString()}` }
function fmtInt(n: number | null): string { return n == null ? '' : `${Math.round(n).toLocaleString()}` }
function fmtPct(n: number | null): string { return n == null ? '' : `${Math.round(n * 10) / 10}%` }
function fmtVal(v: number | null, fmt?: Fmt): string {
  if (fmt === 'money') return fmtMoney(v)
  if (fmt === 'pct') return fmtPct(v)
  return fmtInt(v)
}

// ---------------- Editable cell ----------------
function DataCell({ row, col, onUpdate }: { row: RecurringRow; col: Col; onUpdate: (field: string, value: unknown) => void }) {
  const raw = (row as unknown as Record<string, unknown>)[col.key]

  if (col.type === 'check') {
    return (
      <input
        type="checkbox"
        checked={!!raw}
        onChange={e => onUpdate(col.key, e.target.checked)}
        className="w-4 h-4 accent-indigo-500 cursor-pointer"
      />
    )
  }

  if (col.type === 'color' || col.type === 'select') {
    const value = (raw as string) ?? ''
    const hex = col.colorMap?.[value]
    const style = hex ? { backgroundColor: hex, color: lightText(hex) ? '#1a1a1a' : '#fff', borderColor: 'transparent' } : undefined
    return (
      <select
        value={value}
        onChange={e => onUpdate(col.key, e.target.value || null)}
        className={`w-full rounded px-1.5 py-1 text-xs focus:outline-none cursor-pointer ${hex ? 'font-medium' : 'bg-gray-800 border border-gray-700 text-white'}`}
        style={style}
      >
        <option value="">—</option>
        {col.options!.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }

  if (col.type === 'multi') {
    return <MultiCell value={(raw as string[]) ?? []} options={col.options!} onChange={v => onUpdate(col.key, v.length ? v : null)} />
  }

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

  // text / longtext
  return (
    <input
      type="text"
      defaultValue={(raw as string) ?? ''}
      onBlur={e => onUpdate(col.key, e.target.value.trim() || null)}
      className="w-full bg-transparent text-white text-xs px-1 py-1 rounded focus:bg-gray-800 focus:outline-none border border-transparent focus:border-gray-700"
    />
  )
}

function MultiCell({ value, options, onChange }: { value: string[]; options: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter(x => x !== o) : [...value, o])
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left text-xs text-gray-200 px-1 py-1 rounded hover:bg-gray-800 truncate"
        title={value.join(', ')}
      >
        {value.length ? value.join(', ') : <span className="text-gray-600">—</span>}
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-xl min-w-48 max-h-56 overflow-y-auto py-1">
          {options.map(o => (
            <label key={o} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800 cursor-pointer">
              <input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} className="accent-indigo-500" />
              {o}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------- Page ----------------
export default function RecurringServicesPage() {
  const [rows, setRows] = useState<RecurringRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [cancelledFilter, setCancelledFilter] = useState('')
  const [salespersonFilter, setSalespersonFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<SortState>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (search) p.set('search', search)
    if (groupFilter) p.set('group', groupFilter)
    if (cancelledFilter) p.set('cancelled', cancelledFilter)
    if (salespersonFilter) p.set('salesperson', salespersonFilter)
    const res = await fetch(`/api/tracker/recurring?${p.toString()}`)
    const data = res.ok ? await res.json() : []
    setRows(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [search, groupFilter, cancelledFilter, salespersonFilter])

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])

  const update = useCallback((id: string, field: string, value: unknown) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } as RecurringRow : r))
    fetch(`/api/tracker/recurring/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    }).catch(() => {})
  }, [])

  async function addRow() {
    const res = await fetch('/api/tracker/recurring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Customer', monday_group: 'Customers', cancelled_status: 'Active' }),
    })
    if (res.ok) { const row = await res.json(); setRows(prev => [row, ...prev]) }
  }

  async function deleteRow(id: string) {
    if (!confirm('Delete this row?')) return
    setRows(prev => prev.filter(r => r.id !== id))
    await fetch(`/api/tracker/recurring/${id}`, { method: 'DELETE' })
  }

  const sortedRows = useMemo(() => {
    if (!sort) return rows
    const col = COLS.find(c => c.key === sort.key)
    if (!col) return rows
    return rows
      .map(r => ({ r, v: sortValue(r, col) }))
      .sort((a, b) => compareValues(a.v, b.v, sort.dir))
      .map(d => d.r)
  }, [rows, sort])

  // group rows
  const groupNames = [...GROUP_ORDER, ...Array.from(new Set(rows.map(r => r.monday_group || 'Customers'))).filter(g => !GROUP_ORDER.includes(g))]
  const grouped = groupNames
    .map(g => ({ name: g, rows: sortedRows.filter(r => (r.monday_group || 'Customers') === g) }))
    .filter(g => g.rows.length > 0)

  const totalWidth = COLS.reduce((s, c) => s + c.width, 0) + 40 // + actions col

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-1 overflow-auto min-w-0">
        {/* Sticky header */}
        <div className="sticky top-0 z-20 bg-gray-950 border-b border-gray-800">
          <div className="px-4 pt-2.5 pb-1.5 flex items-center gap-2">
            <Link href="/hub/tracker" className="text-gray-500 hover:text-white text-sm transition-colors whitespace-nowrap" title="Back to Trackers">← Trackers</Link>
            <span className="text-gray-700">/</span>
            <h1 className="text-base font-semibold text-white">Recurring Services</h1>
          </div>
          <div className="px-4 pb-2.5 flex items-center gap-2 flex-wrap">
            <input
              type="text"
              placeholder="Search name, phone, email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 min-w-48 max-w-xs bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
            <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500">
              <option value="">All Groups</option>
              {GROUP_ORDER.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <select value={cancelledFilter} onChange={e => setCancelledFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500">
              <option value="">All Statuses</option>
              {CANCELLED_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={salespersonFilter} onChange={e => setSalespersonFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500">
              <option value="">All Salespersons</option>
              {SALESPERSON_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="text-xs text-gray-600 px-1">{rows.length} record{rows.length !== 1 ? 's' : ''}</span>
            <div className="flex-1" />
            <button onClick={addRow} className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap">+ New</button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-600 text-sm">Loading…</div>
        ) : (
          <div className="space-y-3 p-3">
            {grouped.map(group => {
              const isCollapsed = collapsed.has(group.name)
              const summary = summarize(group.rows)
              const annualSum = group.rows.reduce((s, r) => s + (r.annual_value ?? 0), 0)
              const headerColor = GROUP_COLORS[group.name] ?? '#57606a'
              return (
                <div key={group.name} className="rounded-lg overflow-hidden shadow-sm">
                  <div
                    onClick={() => setCollapsed(prev => { const n = new Set(prev); n.has(group.name) ? n.delete(group.name) : n.add(group.name); return n })}
                    className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:opacity-90 transition-opacity"
                    style={{ backgroundColor: headerColor }}
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
                                className={`px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 cursor-pointer select-none hover:text-gray-200 ${c.kind === 'formula' ? 'text-right' : ''}`}
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
                          {group.rows.map(row => {
                            const f: RecurringFormulas = computeFormulas(row)
                            return (
                              <tr key={row.id} className="border-b border-gray-800/70 hover:bg-gray-900/40">
                                {COLS.map(c => (
                                  <td key={c.key} className={`px-2 py-1 align-middle ${c.kind === 'formula' ? 'text-right text-xs text-gray-300 tabular-nums' : ''}`}>
                                    {c.kind === 'data'
                                      ? <DataCell row={row} col={c} onUpdate={(field, value) => update(row.id, field, value)} />
                                      : fmtVal((f as unknown as Record<string, number | null>)[c.key], c.fmt)}
                                  </td>
                                ))}
                                <td className="px-1 text-center">
                                  <button onClick={() => deleteRow(row.id)} className="text-gray-600 hover:text-red-400 text-xs" title="Delete">✕</button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="bg-gray-900 border-t border-gray-700 font-medium">
                            {COLS.map(c => {
                              let content = ''
                              if (c.footer === 'count') content = `${group.rows.length} total`
                              else if (c.footer === 'sumAnnual') content = fmtMoney(annualSum)
                              else if (c.footer === 'summary') content = fmtVal((summary as unknown as Record<string, number | null>)[c.key], c.fmt)
                              return (
                                <td key={c.key} className={`px-2 py-2 text-xs text-gray-200 ${c.kind === 'formula' || c.footer === 'sumAnnual' ? 'text-right tabular-nums' : ''}`}>
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
  )
}
