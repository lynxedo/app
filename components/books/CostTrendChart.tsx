'use client'

import { useEffect, useRef } from 'react'
import { Chart, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js'
import type { PLData } from '@/app/api/qbo/pl/route'

Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend)

interface Props { data: PLData }

export default function CostTrendChart({ data }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    chartRef.current?.destroy()

    const months = data.months.filter(m => m.revenue > 0)
    const labels = months.map(m => m.month)
    const cogsPct = months.map(m => m.revenue > 0 ? (m.cogs / m.revenue) * 100 : 0)
    // opExpenses includes payroll and other overhead; use as proxy for total payroll % until payroll detail route is built
    const payrollPct = months.map(m => m.revenue > 0 ? (m.opExpenses / m.revenue) * 100 : 0)
    const benchmark = months.map(() => 35)

    chartRef.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'COGS % of Revenue',
            data: cogsPct,
            borderColor: 'rgba(96,165,250,1)',
            backgroundColor: 'rgba(96,165,250,0.1)',
            tension: 0.3,
            fill: true,
          },
          {
            label: 'Op. Expenses % of Revenue',
            data: payrollPct,
            borderColor: 'rgba(167,139,250,1)',
            backgroundColor: 'rgba(167,139,250,0.1)',
            tension: 0.3,
            fill: true,
          },
          {
            label: '35% Payroll Benchmark',
            data: benchmark,
            borderColor: 'rgba(251,191,36,0.7)',
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
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
              label: ctx => ` ${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toFixed(1)}%`,
            },
          },
        },
        scales: {
          x: { ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' } },
          y: {
            ticks: { color: '#9ca3af', callback: v => `${v}%` },
            grid: { color: '#1f2937' },
          },
        },
      },
    })

    return () => chartRef.current?.destroy()
  }, [data])

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h2 className="text-gray-200 font-semibold mb-1">Cost % to Revenue</h2>
      <p className="text-gray-500 text-xs mb-4">Goals: COGS &lt; 12% · Payroll &lt; 35%</p>
      <div className="h-64">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
