'use client'

import { useEffect, useRef } from 'react'
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip)

// MSC-Overhead — these figures are HAND-MAINTAINED, not pulled live from
// QuickBooks. Update OVERHEAD_ITEMS below and bump this date when you revise
// them, so the dashboard caption stays honest about how current the numbers are.
const ESTIMATED_AS_OF = 'June 2026'

const OVERHEAD_ITEMS = [
  { label: 'SBA loan interest',      category: 'Debt service',    monthly: 2900 },
  { label: 'Other interest',         category: 'Debt service',    monthly: 1067 },
  { label: 'Depreciation',           category: 'Non-cash',        monthly: 2225 },
  { label: 'Franchise amortization', category: 'Non-cash',        monthly: 1121 },
  { label: 'Royalty fee',            category: 'Franchise',       monthly: 2000 },
  { label: 'Insurance',              category: 'Fixed overhead',  monthly: 2062 },
  { label: 'Rent',                   category: 'Fixed overhead',  monthly: 2600 },
  { label: 'Accounting',             category: 'Professional',    monthly: 865  },
  { label: 'Software / systems',     category: 'Fixed overhead',  monthly: 550  },
  { label: 'Other professional fees',category: 'Professional',    monthly: 249  },
  { label: 'Phone / internet',       category: 'Fixed overhead',  monthly: 260  },
  { label: 'Utilities',              category: 'Fixed overhead',  monthly: 150  },
  { label: 'Dues / memberships',     category: 'Fixed overhead',  monthly: 52   },
  { label: 'Bank fees (avg)',         category: 'Fixed overhead',  monthly: 100  },
]

const CATEGORY_COLORS: Record<string, string> = {
  'Debt service':   'rgba(248,113,113,0.8)',
  'Non-cash':       'rgba(156,163,175,0.8)',
  'Franchise':      'rgba(251,191,36,0.8)',
  'Fixed overhead': 'rgba(96,165,250,0.8)',
  'Professional':   'rgba(167,139,250,0.8)',
}

const TOTAL = OVERHEAD_ITEMS.reduce((s, i) => s + i.monthly, 0)

export default function OverheadChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    chartRef.current?.destroy()

    const sorted = [...OVERHEAD_ITEMS].sort((a, b) => b.monthly - a.monthly)

    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: sorted.map(i => i.label),
        datasets: [{
          label: 'Monthly Cost',
          data: sorted.map(i => i.monthly),
          backgroundColor: sorted.map(i => CATEGORY_COLORS[i.category] ?? 'rgba(107,114,128,0.8)'),
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const item = sorted[ctx.dataIndex]
                return ` $${(ctx.parsed.x ?? 0).toLocaleString()} · ${item.category}`
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#9ca3af', callback: v => '$' + Number(v).toLocaleString() },
            grid: { color: '#1f2937' },
          },
          y: { ticks: { color: '#d1d5db', font: { size: 12 } }, grid: { display: false } },
        },
      },
    })

    return () => chartRef.current?.destroy()
  }, [])

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-gray-200 font-semibold">Fixed Overhead ("Doors Open" Costs)</h2>
        <span className="text-gray-400 text-sm">
          Total: <span className="text-white font-medium">${TOTAL.toLocaleString()}/mo</span>
        </span>
      </div>
      <div className="h-80">
        <canvas ref={canvasRef} />
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Manually estimated — not pulled live from QuickBooks · as of {ESTIMATED_AS_OF}
      </p>
    </div>
  )
}
