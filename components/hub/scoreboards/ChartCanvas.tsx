'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Chart } from 'chart.js'

// Shared mount-once canvas for every Scoreboard chart. Beyond rendering the
// Chart.js canvas, it adds a "View data" button that opens a spreadsheet-style
// table of the exact numbers behind the chart, with Copy (TSV → paste into
// Sheets/Excel) and Download CSV. The table is derived generically from the
// chart's own labels + datasets, so every chart gets it with no per-chart wiring.

type TableData = { headers: string[]; rows: (string | number)[][]; totalRow: (string | number)[] }

function buildTable(chart: Chart): TableData {
  const type = (chart.config as { type?: string }).type ?? 'bar'
  const isCircular = type === 'doughnut' || type === 'pie'
  const labels = (chart.data.labels ?? []).map(l => String(l))
  const datasets = chart.data.datasets ?? []
  const seriesLabels = datasets.map((d, i) => (d.label && String(d.label)) || (isCircular ? 'Value' : `Series ${i + 1}`))
  const multi = datasets.length > 1

  const headers = [isCircular ? 'Category' : 'Period', ...seriesLabels, ...(multi ? ['Total'] : [])]
  const rows: (string | number)[][] = labels.map((lab, r) => {
    const vals = datasets.map(d => Math.round(Number(d.data[r]) || 0))
    const rowTotal = vals.reduce((a, b) => a + b, 0)
    return [lab, ...vals, ...(multi ? [rowTotal] : [])]
  })
  const totalRow: (string | number)[] = ['Total']
  for (let c = 1; c < headers.length; c++) {
    totalRow.push(rows.reduce((acc, row) => acc + (Number(row[c]) || 0), 0))
  }
  return { headers, rows, totalRow }
}

const fmt = (v: string | number) => (typeof v === 'number' ? v.toLocaleString() : v)

function toMatrix(t: TableData): (string | number)[][] {
  return [t.headers, ...t.rows, t.totalRow]
}
function toTSV(t: TableData): string {
  return toMatrix(t).map(row => row.join('\t')).join('\n')
}
function toCSV(t: TableData): string {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return toMatrix(t).map(row => row.map(esc).join(',')).join('\n')
}

function ChartDataModal({ title, table, onClose }: { title: string; table: TableData; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = async () => {
    try { await navigator.clipboard.writeText(toTSV(table)); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
  }
  const downloadCsv = () => {
    const blob = new Blob([toCSV(table)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(title || 'chart-data').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-sky-400/20 bg-[var(--t-panel)] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
          <div className="text-[15px] font-semibold text-sky-100">{title || 'Chart data'}</div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-gray-400 hover:bg-white/10 hover:text-gray-200">✕</button>
        </div>

        <div className="overflow-auto px-5 py-4">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {table.headers.map((h, i) => (
                  <th key={i} className={`sticky top-0 bg-[var(--t-panel)] border-b border-white/10 px-3 py-2 font-semibold text-gray-300 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={r} className="border-b border-white/5">
                  {row.map((cell, c) => (
                    <td key={c} className={`px-3 py-1.5 ${c === 0 ? 'text-left text-gray-300' : 'text-right tabular-nums text-sky-50'}`}>{fmt(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-white/15">
                {table.totalRow.map((cell, c) => (
                  <td key={c} className={`px-3 py-2 font-semibold ${c === 0 ? 'text-left text-gray-400' : 'text-right tabular-nums text-sky-100'}`}>{fmt(cell)}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-3">
          <button onClick={copy} className="rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-1.5 text-[13px] font-medium text-sky-200 hover:bg-sky-500/20">
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
          <button onClick={downloadCsv} className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[13px] font-medium text-gray-200 hover:bg-white/10">
            Download CSV
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function ChartCanvas({ make, height = 220, title }: { make: (canvas: HTMLCanvasElement) => Chart; height?: number; title?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)
  const [table, setTable] = useState<TableData | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!ref.current) return
    const chart = make(ref.current)
    chartRef.current = chart
    setReady(true)
    return () => { chart.destroy(); chartRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="relative w-full" style={{ height }}>
      <canvas ref={ref} />
      {ready && (
        <button
          type="button"
          onClick={() => { if (chartRef.current) setTable(buildTable(chartRef.current)) }}
          title="View the data behind this chart"
          className="absolute right-1 top-1 z-10 rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] font-medium text-gray-300 backdrop-blur-sm transition hover:bg-black/50 hover:text-white"
        >
          ⊞ Data
        </button>
      )}
      {table && <ChartDataModal title={title ?? ''} table={table} onClose={() => setTable(null)} />}
    </div>
  )
}
