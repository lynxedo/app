'use client'

import type { PLData, PLMonth } from '@/app/api/qbo/pl/route'
import { formatCurrency } from '@/lib/format'

function fmt(n: number) {
  return formatCurrency(n)
}

function pctChange(current: number, prev: number): string | null {
  if (prev === 0) return null
  const pct = ((current - prev) / Math.abs(prev)) * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

function MonthColumn({ month, label }: { month: PLMonth; label: string }) {
  const netColor = month.netIncome >= 0 ? 'text-green-400' : 'text-red-400'
  const margin = month.revenue > 0 ? (month.grossProfit / month.revenue) * 100 : 0

  const rows = [
    { label: 'Revenue',       value: fmt(month.revenue) },
    { label: 'COGS',          value: fmt(month.cogs) },
    { label: 'Gross Profit',  value: fmt(month.grossProfit) },
    { label: 'Gross Margin',  value: `${margin.toFixed(1)}%` },
    { label: 'Op. Expenses',  value: fmt(month.opExpenses) },
    { label: 'Net Income',    value: fmt(month.netIncome), color: netColor },
  ]

  return (
    <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h3 className="text-gray-400 text-sm font-semibold uppercase tracking-wide mb-4">{label}</h3>
      <div className="space-y-2">
        {rows.map(row => (
          <div key={row.label} className="flex justify-between">
            <span className="text-gray-500 text-sm">{row.label}</span>
            <span className={`text-sm font-medium ${row.color ?? 'text-white'}`}>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface Props { data: PLData }

export default function MonthCards({ data }: Props) {
  const activeMonths = data.months.filter(m => m.revenue > 0 || m.cogs > 0)
  const current = activeMonths[activeMonths.length - 1]
  const prev    = activeMonths[activeMonths.length - 2]

  if (!current) return null

  const revChange = prev ? pctChange(current.revenue, prev.revenue) : null

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-gray-200 font-semibold">Month Comparison</h2>
        {revChange && (
          <span className={`text-xs font-medium px-2 py-1 rounded-full ${parseFloat(revChange) >= 0 ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'}`}>
            Revenue {revChange} vs last month
          </span>
        )}
      </div>
      <div className="flex gap-3">
        {prev && <MonthColumn month={prev} label={prev.month} />}
        <MonthColumn month={current} label={`${current.month} (current)`} />
      </div>
    </div>
  )
}
