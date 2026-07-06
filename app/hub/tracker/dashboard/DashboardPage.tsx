'use client'

import { useState, useEffect } from 'react'
import { formatCurrency } from '@/lib/format'

type Lead = {
  id: string
  status: string | null
  stage: string | null
  annual_value: number | null
  sold_date: string | null
  lead_creation_date: string | null
  salesperson: string | null
}

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  return new Date(d.getFullYear(), d.getMonth(), diff)
}

function isSameMonth(d: Date, ref: Date): boolean {
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth()
}

function isSameYear(d: Date, ref: Date): boolean {
  return d.getFullYear() === ref.getFullYear()
}

function parseDate(s: string | null): Date | null {
  if (!s) return null
  const d = new Date(s + 'T12:00:00')
  return isNaN(d.getTime()) ? null : d
}

type MetricCard = {
  label: string
  value: number
  count: number
  isRate?: boolean
}

function Card({ label, value, count, isRate }: MetricCard) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">{label}</p>
      <p className="text-3xl font-bold text-white">
        {isRate ? `${value.toFixed(1)}%` : formatCurrency(value, { abbreviate: true })}
      </p>
      <p className="text-sm text-gray-500 mt-1">{count} lead{count !== 1 ? 's' : ''}</p>
    </div>
  )
}

export default function DashboardPage({
  salespersonOptions,
  isAdmin,
}: {
  salespersonOptions: string[]
  isAdmin: boolean
}) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [salesperson, setSalesperson] = useState('')

  useEffect(() => {
    const params = new URLSearchParams()
    if (salesperson) params.set('salesperson', salesperson)
    fetch(`/api/tracker/leads?${params}`)
      .then(r => r.json())
      .then(data => { setLeads(data); setLoading(false) })
  }, [salesperson])

  const now = new Date()
  const weekStart = startOfWeek(now)
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  function soldLeads(filter?: (d: Date) => boolean): Lead[] {
    return leads.filter(l => {
      if (!['Sold', 'Sold — Upsell', 'closed_won'].includes(l.status ?? l.stage ?? '')) {
        if (l.stage !== 'closed_won') return false
      }
      const d = parseDate(l.sold_date)
      if (!d) return false
      return filter ? filter(d) : true
    })
  }

  function closedWon(filter?: (d: Date) => boolean): Lead[] {
    return leads.filter(l => {
      if (l.stage !== 'closed_won' && l.status !== 'Sold' && l.status !== 'Sold — Upsell') return false
      const d = parseDate(l.sold_date)
      if (!d) return false
      return filter ? filter(d) : true
    })
  }

  function closedLost(filter?: (d: Date) => boolean): Lead[] {
    return leads.filter(l => {
      if (l.stage !== 'closed_lost' && l.status !== 'Not Sold — Changed Mind' && l.status !== 'Not Sold — Other') return false
      const d = parseDate(l.sold_date ?? l.lead_creation_date)
      if (!d) return false
      return filter ? filter(d) : true
    })
  }

  function closeRate(won: Lead[], lost: Lead[]): number {
    const total = won.length + lost.length
    return total === 0 ? 0 : (won.length / total) * 100
  }

  function revenue(ls: Lead[]): number {
    return ls.reduce((sum, l) => sum + (l.annual_value ?? 0), 0)
  }

  const wonYTD = closedWon(d => isSameYear(d, now))
  const wonThisMonth = closedWon(d => isSameMonth(d, now))
  const wonLastMonth = closedWon(d => isSameMonth(d, lastMonth))
  const lostYTD = closedLost(d => isSameYear(d, now))
  const lostThisMonth = closedLost(d => isSameMonth(d, now))
  const lostLastMonth = closedLost(d => isSameMonth(d, lastMonth))
  const wonThisWeek = closedWon(d => d >= weekStart)

  // Salesperson breakdown
  const spBreakdown = salespersonOptions.map(sp => {
    const spLeads = leads.filter(l => l.salesperson === sp && l.stage === 'closed_won')
    return { sp, revenue: revenue(spLeads), count: spLeads.length }
  }).filter(x => x.count > 0).sort((a, b) => b.revenue - a.revenue)

  const maxRevenue = spBreakdown.reduce((m, x) => Math.max(m, x.revenue), 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-600 text-sm">Loading dashboard…</div>
    )
  }

  return (
    <div className="px-6 py-6 max-w-5xl space-y-8">
      {/* Salesperson filter */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-400">View:</span>
        <button
          onClick={() => setSalesperson('')}
          className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${salesperson === '' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
        >
          All
        </button>
        {salespersonOptions.map(sp => (
          <button
            key={sp}
            onClick={() => setSalesperson(sp === salesperson ? '' : sp)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${salesperson === sp ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
          >
            {sp}
          </button>
        ))}
      </div>

      {/* Close Rate */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Close Rate</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card label="YTD" value={closeRate(wonYTD, lostYTD)} count={wonYTD.length + lostYTD.length} isRate />
          <Card label="This Month" value={closeRate(wonThisMonth, lostThisMonth)} count={wonThisMonth.length + lostThisMonth.length} isRate />
          <Card label="Last Month" value={closeRate(wonLastMonth, lostLastMonth)} count={wonLastMonth.length + lostLastMonth.length} isRate />
        </div>
      </div>

      {/* Revenue */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Revenue (Annual Value of Closed Won)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card label="This Week" value={revenue(wonThisWeek)} count={wonThisWeek.length} />
          <Card label="This Month" value={revenue(wonThisMonth)} count={wonThisMonth.length} />
          <Card label="Last Month" value={revenue(wonLastMonth)} count={wonLastMonth.length} />
          <Card label="YTD" value={revenue(wonYTD)} count={wonYTD.length} />
        </div>
      </div>

      {/* Salesperson breakdown */}
      {spBreakdown.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Revenue by Salesperson — YTD</h2>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
            {spBreakdown.map(({ sp, revenue: rev, count }) => (
              <div key={sp}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-white">{sp}</span>
                  <span className="text-sm text-gray-400">{formatCurrency(rev, { abbreviate: true })} <span className="text-gray-600 text-xs">· {count} sold</span></span>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all"
                    style={{ width: maxRevenue > 0 ? `${(rev / maxRevenue) * 100}%` : '0%' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {spBreakdown.length === 0 && (
        <div className="text-center py-12 text-gray-600 text-sm">
          No closed-won leads yet. Revenue will appear here as leads are closed.
        </div>
      )}
    </div>
  )
}
