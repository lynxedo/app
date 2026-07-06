'use client'

import type { PLData } from '@/app/api/qbo/pl/route'
import { formatCurrency } from '@/lib/format'

function fmt(n: number) {
  return formatCurrency(n)
}

interface Props { data: PLData }

export default function YTDStrip({ data }: Props) {
  const { ytd } = data
  const netColor = ytd.netIncome >= 0 ? 'text-green-400' : 'text-red-400'

  const cards = [
    { label: 'YTD Revenue',       value: fmt(ytd.revenue),                         sub: null },
    { label: 'Gross Profit',      value: fmt(ytd.grossProfit),                      sub: `${ytd.grossMarginPct.toFixed(1)}% margin` },
    { label: 'Net Income',        value: fmt(ytd.netIncome),                        sub: null, highlight: netColor },
    { label: 'Best Month',        value: ytd.bestMonth,                             sub: null },
    { label: 'Profitable Months', value: `${ytd.profitableMonths}`,                 sub: `of ${data.months.filter(m => m.revenue > 0).length} active` },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map(card => (
        <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-500 text-xs uppercase tracking-wide mb-1">{card.label}</div>
          <div className={`text-xl font-bold ${card.highlight ?? 'text-white'}`}>{card.value}</div>
          {card.sub && <div className="text-gray-500 text-xs mt-0.5">{card.sub}</div>}
        </div>
      ))}
    </div>
  )
}
