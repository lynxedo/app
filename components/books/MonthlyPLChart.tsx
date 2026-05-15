'use client'

import { useEffect, useRef } from 'react'
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js'
import type { PLData } from '@/app/api/qbo/pl/route'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend)

interface Props { data: PLData }

export default function MonthlyPLChart({ data }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)

  const hasCurrentMonthGap = data.months.length > 0 &&
    data.months[data.months.length - 1].revenue === 0

  useEffect(() => {
    if (!canvasRef.current) return
    chartRef.current?.destroy()

    const months = data.months
    const netColors = months.map(m => m.netIncome >= 0 ? 'rgba(74,222,128,0.8)' : 'rgba(248,113,113,0.8)')

    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: months.map(m => m.month),
        datasets: [
          {
            label: 'Revenue',
            data: months.map(m => m.revenue),
            backgroundColor: 'rgba(96,165,250,0.8)',
          },
          {
            label: 'Gross Profit',
            data: months.map(m => m.grossProfit),
            backgroundColor: 'rgba(52,211,153,0.8)',
          },
          {
            label: 'Net Income',
            data: months.map(m => m.netIncome),
            backgroundColor: netColors,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#9ca3af' } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const val = ctx.parsed.y ?? 0
                return ` ${ctx.dataset.label}: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)}`
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' } },
          y: {
            ticks: {
              color: '#9ca3af',
              callback: v => '$' + Number(v).toLocaleString(),
            },
            grid: { color: '#1f2937' },
          },
        },
      },
    })

    return () => chartRef.current?.destroy()
  }, [data])

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h2 className="text-gray-200 font-semibold mb-4">Monthly P&amp;L</h2>
      {hasCurrentMonthGap && (
        <p className="text-yellow-500 text-xs mb-3">
          Invoices for the current month may not yet be fully posted.
        </p>
      )}
      <div className="h-72">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
