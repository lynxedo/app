'use client'

import { useState, useEffect, useCallback } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

type RawRow = {
  tech_name: string
  tech_external_id: string
  dept_prefix: string | null
  is_recurring: boolean | null
  visit_count: number
  total_value: string | number
}

type DeptBreakdown = {
  visits: number
  value: number
}

type TechRow = {
  name: string
  totalVisits: number
  totalValue: number
  recurringVisits: number
  recurringValue: number
  oneOffVisits: number
  oneOffValue: number
  byDept: Record<string, DeptBreakdown>
}

type DateRange = { start: string; end: string; label: string }

// ── Date helpers ─────────────────────────────────────────────────────────────

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getQuickRanges(): DateRange[] {
  const today = new Date()
  const dow = today.getDay() // 0=Sun
  const monday = new Date(today)
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))

  const thisMonStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const thisMonEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  const lastMonStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const lastMonEnd = new Date(today.getFullYear(), today.getMonth(), 0)
  const ytdStart = new Date(today.getFullYear(), 0, 1)

  const thisWeekEnd = new Date(monday)
  thisWeekEnd.setDate(monday.getDate() + 6)

  const lastWeekMon = new Date(monday)
  lastWeekMon.setDate(monday.getDate() - 7)
  const lastWeekSun = new Date(lastWeekMon)
  lastWeekSun.setDate(lastWeekMon.getDate() + 6)

  return [
    { label: 'This Week',  start: fmt(monday),      end: fmt(thisWeekEnd)  },
    { label: 'Last Week',  start: fmt(lastWeekMon), end: fmt(lastWeekSun)  },
    { label: 'This Month', start: fmt(thisMonStart), end: fmt(thisMonEnd)  },
    { label: 'Last Month', start: fmt(lastMonStart), end: fmt(lastMonEnd)  },
    { label: 'YTD',        start: fmt(ytdStart),     end: fmt(today)       },
  ]
}

// ── Aggregation ──────────────────────────────────────────────────────────────

function aggregate(rows: RawRow[]): TechRow[] {
  const map = new Map<string, TechRow>()

  for (const r of rows) {
    if (!map.has(r.tech_name)) {
      map.set(r.tech_name, {
        name: r.tech_name,
        totalVisits: 0, totalValue: 0,
        recurringVisits: 0, recurringValue: 0,
        oneOffVisits: 0, oneOffValue: 0,
        byDept: {},
      })
    }
    const t = map.get(r.tech_name)!
    const val = Number(r.total_value) || 0
    const cnt = Number(r.visit_count) || 0

    t.totalVisits += cnt
    t.totalValue  += val

    if (r.is_recurring) {
      t.recurringVisits += cnt
      t.recurringValue  += val
    } else {
      t.oneOffVisits += cnt
      t.oneOffValue  += val
    }

    const dept = r.dept_prefix ?? '—'
    if (!t.byDept[dept]) t.byDept[dept] = { visits: 0, value: 0 }
    t.byDept[dept].visits += cnt
    t.byDept[dept].value  += val
  }

  return Array.from(map.values()).sort((a, b) => b.totalVisits - a.totalVisits)
}

// ── Formatting ───────────────────────────────────────────────────────────────

function usd(n: number) {
  return n === 0 ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pct(num: number, den: number) {
  if (!den) return '—'
  return Math.round((num / den) * 100) + '%'
}

// ── Component ────────────────────────────────────────────────────────────────

export default function VisitsReportView() {
  const ranges = getQuickRanges()
  const [selected, setSelected] = useState<DateRange>(ranges[0])
  const [custom, setCustom] = useState({ start: '', end: '' })
  const [showCustom, setShowCustom] = useState(false)
  const [rows, setRows] = useState<TechRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const fetchReport = useCallback(async (range: DateRange) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/hub/reports/visits?start=${range.start}&end=${range.end}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Unknown error')
      setRows(aggregate(json.rows))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchReport(selected) }, [selected, fetchReport])

  function applyCustom() {
    if (!custom.start || !custom.end) return
    const range: DateRange = { ...custom, label: 'Custom' }
    setSelected(range)
    setShowCustom(false)
  }

  function toggleExpand(name: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const totalVisits  = rows.reduce((s, r) => s + r.totalVisits,  0)
  const totalValue   = rows.reduce((s, r) => s + r.totalValue,   0)
  const totalRec     = rows.reduce((s, r) => s + r.recurringVisits, 0)
  const totalRecVal  = rows.reduce((s, r) => s + r.recurringValue,  0)
  const totalOne     = rows.reduce((s, r) => s + r.oneOffVisits,  0)
  const totalOneVal  = rows.reduce((s, r) => s + r.oneOffValue,   0)

  return (
    <div className="flex flex-col h-full bg-slate-950 text-white">
      {/* Header */}
      <div className="flex-none border-b border-white/10 px-4 py-3">
        <h1 className="text-lg font-semibold">Visit Report</h1>
        <p className="text-sm text-white/50">Completed visits by technician</p>
      </div>

      {/* Date range selector */}
      <div className="flex-none border-b border-white/10 px-4 py-3">
        <div className="flex flex-wrap gap-2 items-center">
          {ranges.map(r => (
            <button
              key={r.label}
              onClick={() => { setShowCustom(false); setSelected(r) }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                selected.label === r.label && !showCustom
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              {r.label}
            </button>
          ))}
          <button
            onClick={() => setShowCustom(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              showCustom ? 'bg-indigo-600 text-white' : 'bg-white/5 text-white/70 hover:bg-white/10'
            }`}
          >
            Custom
          </button>
          {showCustom && (
            <div className="flex items-center gap-2 ml-1">
              <input
                type="date"
                value={custom.start}
                onChange={e => setCustom(p => ({ ...p, start: e.target.value }))}
                className="bg-white/10 text-white rounded px-2 py-1 text-sm border border-white/20"
              />
              <span className="text-white/40 text-sm">to</span>
              <input
                type="date"
                value={custom.end}
                onChange={e => setCustom(p => ({ ...p, end: e.target.value }))}
                className="bg-white/10 text-white rounded px-2 py-1 text-sm border border-white/20"
              />
              <button
                onClick={applyCustom}
                disabled={!custom.start || !custom.end}
                className="px-3 py-1 rounded bg-indigo-600 text-white text-sm disabled:opacity-40"
              >
                Apply
              </button>
            </div>
          )}
        </div>
        {selected.label !== 'Custom' ? null : (
          <p className="text-xs text-white/40 mt-1">{selected.start} → {selected.end}</p>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-40 text-white/40">Loading…</div>
        )}
        {error && (
          <div className="m-4 p-3 rounded bg-red-900/40 text-red-300 text-sm">{error}</div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="flex items-center justify-center h-40 text-white/40">No completed visits in this range.</div>
        )}

        {!loading && !error && rows.length > 0 && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
              <SummaryCard label="Total Visits" value={String(totalVisits)} />
              <SummaryCard label="Total Value" value={totalValue === 0 ? '—' : '$' + totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })} />
              <SummaryCard label="Recurring" value={`${totalRec} visits`} sub={totalRecVal > 0 ? usd(totalRecVal) : undefined} />
              <SummaryCard label="One-Off" value={`${totalOne} visits`} sub={totalOneVal > 0 ? usd(totalOneVal) : undefined} />
            </div>

            {/* Table */}
            <div className="px-4 pb-6">
              <div className="rounded-xl border border-white/10 overflow-hidden">
                {/* Table header */}
                <div className="grid grid-cols-[1fr_80px_100px_120px_120px] gap-0 bg-white/5 px-4 py-2 text-xs font-semibold text-white/50 uppercase tracking-wider hidden md:grid">
                  <div>Technician</div>
                  <div className="text-right">Visits</div>
                  <div className="text-right">Value</div>
                  <div className="text-right">Recurring</div>
                  <div className="text-right">One-Off</div>
                </div>

                {/* Totals row */}
                <div className="grid grid-cols-[1fr_80px_100px_120px_120px] gap-0 bg-white/10 px-4 py-2.5 text-sm font-semibold border-b border-white/10 hidden md:grid">
                  <div className="text-white/70">All Technicians</div>
                  <div className="text-right">{totalVisits}</div>
                  <div className="text-right text-emerald-400">{totalValue === 0 ? '—' : '$' + totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                  <div className="text-right text-white/60">{totalRec} · {pct(totalRec, totalVisits)}</div>
                  <div className="text-right text-white/60">{totalOne} · {pct(totalOne, totalVisits)}</div>
                </div>

                {/* Tech rows */}
                {rows.map((tech, i) => {
                  const isExpanded = expanded.has(tech.name)
                  const deptKeys = Object.keys(tech.byDept).sort()
                  return (
                    <div key={tech.name} className={i > 0 ? 'border-t border-white/5' : ''}>
                      <button
                        onClick={() => toggleExpand(tech.name)}
                        className="w-full text-left hover:bg-white/5 transition-colors"
                      >
                        {/* Mobile layout */}
                        <div className="md:hidden px-4 py-3">
                          <div className="flex justify-between items-start">
                            <span className="font-medium">{tech.name}</span>
                            <span className="text-emerald-400 font-medium">{tech.totalValue > 0 ? usd(tech.totalValue) : `${tech.totalVisits} visits`}</span>
                          </div>
                          <div className="text-xs text-white/50 mt-0.5">
                            {tech.totalVisits} visits · {tech.recurringVisits} recurring · {tech.oneOffVisits} one-off
                          </div>
                        </div>

                        {/* Desktop layout */}
                        <div className="hidden md:grid grid-cols-[1fr_80px_100px_120px_120px] gap-0 px-4 py-3 items-center">
                          <div className="flex items-center gap-2">
                            <svg className={`w-3.5 h-3.5 text-white/30 transition-transform flex-none ${isExpanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M9 18l6-6-6-6" />
                            </svg>
                            <span className="font-medium">{tech.name}</span>
                          </div>
                          <div className="text-right">{tech.totalVisits}</div>
                          <div className="text-right text-emerald-400">{tech.totalValue > 0 ? usd(tech.totalValue) : '—'}</div>
                          <div className="text-right text-white/60">
                            {tech.recurringVisits}
                            {tech.recurringValue > 0 && <span className="text-white/40 text-xs ml-1">({usd(tech.recurringValue)})</span>}
                          </div>
                          <div className="text-right text-white/60">
                            {tech.oneOffVisits}
                            {tech.oneOffValue > 0 && <span className="text-white/40 text-xs ml-1">({usd(tech.oneOffValue)})</span>}
                          </div>
                        </div>
                      </button>

                      {/* Dept breakdown */}
                      {isExpanded && deptKeys.length > 0 && (
                        <div className="bg-white/[0.03] border-t border-white/5">
                          {deptKeys.map(dept => (
                            <div
                              key={dept}
                              className="grid grid-cols-[1fr_80px_100px] md:grid-cols-[1fr_80px_100px_120px_120px] gap-0 px-4 md:px-10 py-2 text-sm text-white/60 border-b border-white/5 last:border-0"
                            >
                              <div className="flex items-center gap-2">
                                <DeptChip dept={dept} />
                              </div>
                              <div className="text-right">{tech.byDept[dept].visits}</div>
                              <div className="text-right">{tech.byDept[dept].value > 0 ? usd(tech.byDept[dept].value) : '—'}</div>
                              <div className="hidden md:block" />
                              <div className="hidden md:block" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <p className="text-xs text-white/30 mt-3">
                Dollar values reflect visits with per-visit line items. Flat-rate recurring jobs bill at job level and show $0 visit value.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white/5 rounded-xl p-4 border border-white/10">
      <div className="text-xs text-white/50 font-medium uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className="text-sm text-emerald-400 mt-0.5">{sub}</div>}
    </div>
  )
}

const DEPT_COLORS: Record<string, string> = {
  IR: 'bg-blue-500/20 text-blue-300',
  WF: 'bg-green-500/20 text-green-300',
  PW: 'bg-purple-500/20 text-purple-300',
  MO: 'bg-amber-500/20 text-amber-300',
  '—': 'bg-white/10 text-white/40',
}

function DeptChip({ dept }: { dept: string }) {
  const cls = DEPT_COLORS[dept] ?? 'bg-white/10 text-white/40'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {dept}
    </span>
  )
}
