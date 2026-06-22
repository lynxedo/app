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

type TechRow = {
  name: string
  externalId: string
  totalVisits: number
  totalValue: number
  recurringVisits: number
  recurringValue: number
  oneOffVisits: number
  oneOffValue: number
}

type VisitDetail = {
  visit_id: string
  scheduled_date: string
  client_name: string | null
  job_title: string | null
  dept_prefix: string | null
  is_recurring: boolean | null
  total_value: string | number
}

type DateRange = { start: string; end: string; label: string }

// ── Date helpers ─────────────────────────────────────────────────────────────

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function fmtDate(iso: string): string {
  const [y, m, day] = iso.split('-').map(Number)
  const d = new Date(y, m - 1, day)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function getQuickRanges(): DateRange[] {
  const today = new Date()
  const dow = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))

  const thisMonStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const thisMonEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  const lastMonStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const lastMonEnd   = new Date(today.getFullYear(), today.getMonth(), 0)
  const ytdStart     = new Date(today.getFullYear(), 0, 1)

  const thisWeekEnd = new Date(monday)
  thisWeekEnd.setDate(monday.getDate() + 6)

  const lastWeekMon = new Date(monday)
  lastWeekMon.setDate(monday.getDate() - 7)
  const lastWeekSun = new Date(lastWeekMon)
  lastWeekSun.setDate(lastWeekMon.getDate() + 6)

  return [
    { label: 'This Week',  start: fmt(monday),       end: fmt(thisWeekEnd)  },
    { label: 'Last Week',  start: fmt(lastWeekMon),  end: fmt(lastWeekSun)  },
    { label: 'This Month', start: fmt(thisMonStart), end: fmt(thisMonEnd)   },
    { label: 'Last Month', start: fmt(lastMonStart), end: fmt(lastMonEnd)   },
    { label: 'YTD',        start: fmt(ytdStart),     end: fmt(today)        },
  ]
}

// ── Aggregation ──────────────────────────────────────────────────────────────

function aggregate(rows: RawRow[]): TechRow[] {
  const map = new Map<string, TechRow>()

  for (const r of rows) {
    if (!map.has(r.tech_name)) {
      map.set(r.tech_name, {
        name: r.tech_name,
        externalId: r.tech_external_id,
        totalVisits: 0, totalValue: 0,
        recurringVisits: 0, recurringValue: 0,
        oneOffVisits: 0, oneOffValue: 0,
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
  }

  return Array.from(map.values()).sort((a, b) => b.totalVisits - a.totalVisits)
}

// ── Formatting ───────────────────────────────────────────────────────────────

function usd(n: number) {
  if (n === 0) return '—'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pct(num: number, den: number) {
  if (!den) return '—'
  return Math.round((num / den) * 100) + '%'
}

// ── Component ────────────────────────────────────────────────────────────────

export default function VisitsReportView() {
  const ranges = getQuickRanges()
  const [selected, setSelected]   = useState<DateRange>(ranges[0])
  const [custom, setCustom]       = useState({ start: '', end: '' })
  const [showCustom, setShowCustom] = useState(false)
  const [rows, setRows]           = useState<TechRow[]>([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [expanded, setExpanded]   = useState<Set<string>>(new Set())
  // key = tech name, value = visit list (null = not yet loaded)
  const [detailCache, setDetailCache]   = useState<Record<string, VisitDetail[]>>({})
  const [detailLoading, setDetailLoading] = useState<Set<string>>(new Set())

  const fetchReport = useCallback(async (range: DateRange) => {
    setLoading(true)
    setError(null)
    setExpanded(new Set())
    setDetailCache({})
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
    setSelected({ ...custom, label: 'Custom' })
    setShowCustom(false)
  }

  async function toggleExpand(tech: TechRow) {
    const name = tech.name
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })

    // Fetch detail on first open
    if (!expanded.has(name) && !(name in detailCache) && !detailLoading.has(name)) {
      setDetailLoading(prev => new Set(prev).add(name))
      try {
        const res = await fetch(
          `/api/hub/reports/visits/detail?start=${selected.start}&end=${selected.end}&tech=${encodeURIComponent(tech.externalId)}`
        )
        const json = await res.json()
        setDetailCache(prev => ({ ...prev, [name]: json.visits ?? [] }))
      } catch {
        setDetailCache(prev => ({ ...prev, [name]: [] }))
      } finally {
        setDetailLoading(prev => { const s = new Set(prev); s.delete(name); return s })
      }
    }
  }

  const totalVisits = rows.reduce((s, r) => s + r.totalVisits, 0)
  const totalValue  = rows.reduce((s, r) => s + r.totalValue,  0)
  const totalRec    = rows.reduce((s, r) => s + r.recurringVisits, 0)
  const totalRecVal = rows.reduce((s, r) => s + r.recurringValue,  0)
  const totalOne    = rows.reduce((s, r) => s + r.oneOffVisits, 0)
  const totalOneVal = rows.reduce((s, r) => s + r.oneOffValue,  0)

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Header */}
      <div className="flex-none border-b border-white/10 px-4 py-3 max-md:pl-14">
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
                  ? 'bg-indigo-600 text-[#fff]'
                  : 'bg-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              {r.label}
            </button>
          ))}
          <button
            onClick={() => setShowCustom(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              showCustom ? 'bg-indigo-600 text-[#fff]' : 'bg-white/5 text-white/70 hover:bg-white/10'
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
                className="px-3 py-1 rounded bg-indigo-600 text-[#fff] text-sm disabled:opacity-40"
              >
                Apply
              </button>
            </div>
          )}
        </div>
        {selected.label === 'Custom' && (
          <p className="text-xs text-white/40 mt-1">{selected.start} → {selected.end}</p>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-40 text-white/40">Loading…</div>
        )}
        {error && (
          <div className="m-4 p-3 rounded bg-red-500/15 text-[var(--t-tint-danger)] text-sm">{error}</div>
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

            {/* Tech table */}
            <div className="px-4 pb-6">
              <div className="rounded-xl border border-white/10 overflow-hidden">
                {/* Header row */}
                <div className="hidden md:grid grid-cols-[1fr_80px_100px_120px_120px] bg-white/5 px-4 py-2 text-xs font-semibold text-white/50 uppercase tracking-wider">
                  <div>Technician</div>
                  <div className="text-right">Visits</div>
                  <div className="text-right">Value</div>
                  <div className="text-right">Recurring</div>
                  <div className="text-right">One-Off</div>
                </div>

                {/* Totals row */}
                <div className="hidden md:grid grid-cols-[1fr_80px_100px_120px_120px] bg-white/10 px-4 py-2.5 text-sm font-semibold border-b border-white/10">
                  <div className="text-white/70">All Technicians</div>
                  <div className="text-right">{totalVisits}</div>
                  <div className="text-right text-[var(--t-tint-success)]">{totalValue === 0 ? '—' : '$' + totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                  <div className="text-right text-white/60">{totalRec} · {pct(totalRec, totalVisits)}</div>
                  <div className="text-right text-white/60">{totalOne} · {pct(totalOne, totalVisits)}</div>
                </div>

                {/* Tech rows */}
                {rows.map((tech, i) => {
                  const isExpanded   = expanded.has(tech.name)
                  const isLoading    = detailLoading.has(tech.name)
                  const visitList    = detailCache[tech.name] ?? null

                  return (
                    <div key={tech.name} className={i > 0 ? 'border-t border-white/5' : ''}>
                      {/* Tech summary row — tap to expand */}
                      <button
                        onClick={() => toggleExpand(tech)}
                        className="w-full text-left hover:bg-white/5 transition-colors"
                      >
                        {/* Mobile */}
                        <div className="md:hidden px-4 py-3">
                          <div className="flex justify-between items-start">
                            <span className="font-medium">{tech.name}</span>
                            <span className="text-[var(--t-tint-success)] font-medium">
                              {tech.totalValue > 0 ? usd(tech.totalValue) : `${tech.totalVisits} visits`}
                            </span>
                          </div>
                          <div className="text-xs text-white/50 mt-0.5">
                            {tech.totalVisits} visits · {tech.recurringVisits} recurring · {tech.oneOffVisits} one-off
                          </div>
                        </div>

                        {/* Desktop */}
                        <div className="hidden md:grid grid-cols-[1fr_80px_100px_120px_120px] px-4 py-3 items-center">
                          <div className="flex items-center gap-2">
                            <svg
                              className={`w-3.5 h-3.5 text-white/30 transition-transform flex-none ${isExpanded ? 'rotate-90' : ''}`}
                              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                            >
                              <path d="M9 18l6-6-6-6" />
                            </svg>
                            <span className="font-medium">{tech.name}</span>
                          </div>
                          <div className="text-right">{tech.totalVisits}</div>
                          <div className="text-right text-[var(--t-tint-success)]">{tech.totalValue > 0 ? usd(tech.totalValue) : '—'}</div>
                          <div className="text-right text-white/60">
                            {tech.recurringVisits}
                            {tech.recurringValue > 0 && (
                              <span className="text-white/40 text-xs ml-1">({usd(tech.recurringValue)})</span>
                            )}
                          </div>
                          <div className="text-right text-white/60">
                            {tech.oneOffVisits}
                            {tech.oneOffValue > 0 && (
                              <span className="text-white/40 text-xs ml-1">({usd(tech.oneOffValue)})</span>
                            )}
                          </div>
                        </div>
                      </button>

                      {/* Visit list — shown when expanded */}
                      {isExpanded && (
                        <div className="bg-white/[0.03] border-t border-white/5">
                          {isLoading && (
                            <div className="px-8 py-4 text-sm text-white/40">Loading visits…</div>
                          )}

                          {!isLoading && visitList && visitList.length === 0 && (
                            <div className="px-8 py-4 text-sm text-white/40">No visits found.</div>
                          )}

                          {!isLoading && visitList && visitList.length > 0 && (
                            <>
                              {/* Visit list header — desktop */}
                              <div className="hidden md:grid grid-cols-[110px_1fr_1fr_60px_80px_100px] px-8 py-2 text-xs font-semibold text-white/30 uppercase tracking-wider border-b border-white/5">
                                <div>Date</div>
                                <div>Customer</div>
                                <div>Job</div>
                                <div>Dept</div>
                                <div>Type</div>
                                <div className="text-right">Value</div>
                              </div>

                              {visitList.map(v => (
                                <div
                                  key={v.visit_id}
                                  className="border-b border-white/5 last:border-0"
                                >
                                  {/* Desktop row */}
                                  <div className="hidden md:grid grid-cols-[110px_1fr_1fr_60px_80px_100px] px-8 py-2.5 text-sm items-center hover:bg-white/5">
                                    <div className="text-white/50 text-xs">{fmtDate(v.scheduled_date)}</div>
                                    <div className="text-white/90 truncate pr-3">{v.client_name ?? '—'}</div>
                                    <div className="text-white/60 truncate pr-3 text-xs">{v.job_title ?? '—'}</div>
                                    <div>
                                      {v.dept_prefix ? <DeptChip dept={v.dept_prefix} /> : <span className="text-white/20 text-xs">—</span>}
                                    </div>
                                    <div>
                                      <span className={`text-xs font-medium ${v.is_recurring ? 'text-[var(--t-tint-info)]' : 'text-[var(--t-tint-warning)]'}`}>
                                        {v.is_recurring ? 'Recurring' : 'One-off'}
                                      </span>
                                    </div>
                                    <div className="text-right text-[var(--t-tint-success)] text-sm">
                                      {Number(v.total_value) > 0 ? usd(Number(v.total_value)) : <span className="text-white/20">—</span>}
                                    </div>
                                  </div>

                                  {/* Mobile row */}
                                  <div className="md:hidden px-4 py-2.5">
                                    <div className="flex justify-between items-start gap-2">
                                      <div className="min-w-0">
                                        <div className="text-white/90 text-sm font-medium truncate">{v.client_name ?? '—'}</div>
                                        <div className="text-white/50 text-xs truncate mt-0.5">{v.job_title ?? '—'}</div>
                                      </div>
                                      <div className="flex-none text-right">
                                        <div className="text-[var(--t-tint-success)] text-sm">
                                          {Number(v.total_value) > 0 ? usd(Number(v.total_value)) : <span className="text-white/20">—</span>}
                                        </div>
                                        <div className="text-white/40 text-xs mt-0.5">{fmtDate(v.scheduled_date)}</div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                      {v.dept_prefix && <DeptChip dept={v.dept_prefix} />}
                                      <span className={`text-xs ${v.is_recurring ? 'text-[var(--t-tint-info)]' : 'text-[var(--t-tint-warning)]'}`}>
                                        {v.is_recurring ? 'Recurring' : 'One-off'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </>
                          )}
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
      {sub && <div className="text-sm text-[var(--t-tint-success)] mt-0.5">{sub}</div>}
    </div>
  )
}

const DEPT_COLORS: Record<string, string> = {
  IR: 'bg-blue-500/20 text-[var(--t-tint-blue)]',
  WF: 'bg-green-500/20 text-[var(--t-tint-green)]',
  PW: 'bg-purple-500/20 text-[var(--t-tint-purple)]',
  MO: 'bg-amber-500/20 text-[var(--t-tint-warning)]',
}

function DeptChip({ dept }: { dept: string }) {
  const cls = DEPT_COLORS[dept] ?? 'bg-white/10 text-white/40'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {dept}
    </span>
  )
}
