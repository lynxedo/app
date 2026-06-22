'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Chart, BarController, BarElement, LineController, LineElement, PointElement,
  DoughnutController, ArcElement, CategoryScale, LinearScale, Tooltip, Legend, Filler,
} from 'chart.js'
import type { ScoreboardMeta } from '@/lib/scoreboards/registry'
import { useScoreboardData } from '@/hooks/use-scoreboard-data'
import ScoreboardError from '@/components/hub/ScoreboardError'
import SnapshotControls from '@/components/hub/scoreboards/SnapshotControls'

Chart.register(
  BarController, BarElement, LineController, LineElement, PointElement,
  DoughnutController, ArcElement, CategoryScale, LinearScale, Tooltip, Legend, Filler,
)
Chart.defaults.color = '#64748b'
Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
Chart.defaults.font.size = 11

// ── Types (mirror the API payload) ──
type DeptData = Record<string, number[]>
type Payload = {
  asOf: string
  depts: string[]
  kpis: {
    ytdRevenue: number; lastMonthRevenue: number; lastMonthLabel: string
    retentionRate: number; activeRecurring: number
    ytdNewSalesCount: number; ytdNewSalesValue: number
  }
  ytdByMonth: { labels: string[]; data: DeptData }
  weekly: { labels: string[]; data: DeptData }
  lastMonth: { label: string; rows: { dept: string; total: number }[] }
  sales: { labels: string[]; won: number[]; upsells: number[] }
  leadSources: { src: string; n: number }[]
  closeRate: { week: string; won: number; total: number }[]
  retention: { active: number; upgraded: number; downgraded: number; cancelled: number; total: number; rate: number }
}

const DEPT_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  IR: { bg: 'rgba(14,165,233,0.75)', border: '#0ea5e9', label: 'Irrigation (IR)' },
  WF: { bg: 'rgba(34,197,94,0.75)', border: '#22c55e', label: 'Lawn Care (WF)' },
  PW: { bg: 'rgba(245,158,11,0.75)', border: '#f59e0b', label: 'Pet Waste (PW)' },
  MO: { bg: 'rgba(139,92,246,0.75)', border: '#8b5cf6', label: 'Mosquito (MO)' },
  Other: { bg: 'rgba(100,116,139,0.75)', border: '#64748b', label: 'Other' },
}
const PIE_COLORS = ['#0ea5e9', '#38bdf8', '#22c55e', '#f59e0b', '#8b5cf6']
const GRID = 'rgba(255,255,255,0.06)'
const usd = (v: number) => '$' + Math.round(v).toLocaleString()
const usdTick = (v: number | string) => { const n = Number(v); return '$' + (n >= 1000 ? Math.round(n / 1000) + 'k' : n) }

const stackedScales = {
  x: { stacked: true, grid: { color: GRID }, ticks: { color: '#64748b' } },
  y: { stacked: true, grid: { color: GRID }, ticks: { color: '#64748b', callback: usdTick } },
}
const tooltipStyle = {
  backgroundColor: 'rgba(15,46,71,0.96)', borderColor: 'rgba(56,189,248,0.3)', borderWidth: 1,
  titleColor: '#bae6fd', bodyColor: '#94a3b8', padding: 10,
}

// Mount-once canvas: builds the chart on mount and destroys on unmount. Parent
// only renders this once data has loaded, so a mount-once lifecycle is correct.
function ChartCanvas({ make, height = 220 }: { make: (canvas: HTMLCanvasElement) => Chart; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const chart = make(ref.current)
    return () => chart.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // maintainAspectRatio:false requires a fixed-height parent, else the canvas
  // balloons. Bound the height here (same pattern as OverheadChart).
  return <div className="relative w-full" style={{ height }}><canvas ref={ref} /></div>
}

// ── Layout primitives ──
function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-sky-400/12 bg-gradient-to-br from-[var(--t-panel)] to-[var(--t-sidebar)] p-5 ${className}`}>
      <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-sky-500 via-sky-400 to-transparent" />
      {children}
    </div>
  )
}
function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="mt-8 mb-3.5 text-[11px] font-semibold uppercase tracking-[1.2px] text-slate-500 first:mt-0">{children}</div>
}
function ChartHead({ title, sub }: { title: string; sub: string }) {
  return (<><div className="text-[13px] font-semibold text-sky-200">{title}</div><div className="mb-3.5 text-[11px] text-slate-500">{sub}</div></>)
}
function Legends({ depts }: { depts: string[] }) {
  return (
    <div className="mt-2.5 flex flex-wrap gap-2.5">
      {depts.map(d => {
        const c = DEPT_COLORS[d] ?? DEPT_COLORS.Other
        return <span key={d} className="flex items-center gap-1.5 text-[11px] text-slate-400"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.border }} />{c.label}</span>
      })}
    </div>
  )
}

function Dashboard({ data, meta }: { data: Payload; meta: ScoreboardMeta }) {
  const { kpis, depts } = data
  const year = new Date(data.asOf).getFullYear()

  // Build stacked-bar datasets for a dept-keyed series.
  const deptDatasets = (series: DeptData) => depts.map(d => ({
    label: DEPT_COLORS[d]?.label ?? d,
    data: series[d] ?? [],
    backgroundColor: DEPT_COLORS[d]?.bg, borderColor: DEPT_COLORS[d]?.border, borderWidth: 1, borderRadius: 2,
  }))

  const closePcts = data.closeRate.map(d => d.total > 0 ? Math.round((d.won / d.total) * 1000) / 10 : 0)

  return (
    <div className="mx-auto max-w-[1280px] px-4 md:px-6 pb-12 pt-2">
      {/* KPI summary */}
      <SectionTitle>Year at a Glance</SectionTitle>
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Card>
          <div className="text-[11px] font-medium text-sky-300">YTD Visit Revenue</div>
          <div className="mt-1.5 text-[26px] font-bold leading-none tracking-tight text-sky-50">{usd(kpis.ytdRevenue)}</div>
          <div className="mt-1.5 text-[11px] text-slate-500">Jan – {year}</div>
        </Card>
        <Card>
          <div className="text-[11px] font-medium text-sky-300">Last Month Revenue</div>
          <div className="mt-1.5 text-[26px] font-bold leading-none tracking-tight text-sky-50">{usd(kpis.lastMonthRevenue)}</div>
          <div className="mt-1.5 text-[11px] text-slate-500">{kpis.lastMonthLabel || '—'}</div>
        </Card>
        <Card>
          <div className="text-[11px] font-medium text-sky-300">Recurring Retention</div>
          <div className="mt-1.5 text-[26px] font-bold leading-none tracking-tight text-sky-50">{kpis.retentionRate}%</div>
          <span className="mt-1.5 inline-block rounded-full bg-green-500/15 px-2 py-0.5 text-[11px] font-semibold text-green-400">{kpis.activeRecurring} Active</span>
        </Card>
        <Card>
          <div className="text-[11px] font-medium text-sky-300">YTD New Sales</div>
          <div className="mt-1.5 text-[26px] font-bold leading-none tracking-tight text-sky-50">{kpis.ytdNewSalesCount}</div>
          <div className="mt-1.5 text-[11px] text-slate-500">Closed Won + Upsells</div>
          <span className="mt-1.5 inline-block rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-400">{usd(kpis.ytdNewSalesValue)} value</span>
        </Card>
      </div>

      {/* Visit revenue */}
      <SectionTitle>Visit Revenue</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <ChartHead title="YTD Revenue by Month" sub={`Jan – ${year} · by Department`} />
          <ChartCanvas make={c => new Chart(c, {
            type: 'bar',
            data: { labels: data.ytdByMonth.labels, datasets: deptDatasets(data.ytdByMonth.data) },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${usd(ctx.parsed.y ?? 0)}` } } },
              scales: stackedScales,
            },
          })} />
          <Legends depts={depts} />
        </Card>
        <Card>
          <ChartHead title="Trailing 6-Week Revenue" sub="Weekly · by Department" />
          <ChartCanvas make={c => new Chart(c, {
            type: 'bar',
            data: { labels: data.weekly.labels, datasets: deptDatasets(data.weekly.data) },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${usd(ctx.parsed.y ?? 0)}` } } },
              scales: stackedScales,
            },
          })} />
          <Legends depts={depts} />
        </Card>
        <Card>
          <ChartHead title="Last Month Revenue" sub={`${data.lastMonth.label || 'Last month'} · by Department`} />
          <ChartCanvas make={c => new Chart(c, {
            type: 'bar',
            data: {
              labels: data.lastMonth.rows.map(r => DEPT_COLORS[r.dept]?.label ?? r.dept),
              datasets: [{
                data: data.lastMonth.rows.map(r => r.total),
                backgroundColor: data.lastMonth.rows.map(r => DEPT_COLORS[r.dept]?.bg ?? DEPT_COLORS.Other.bg),
                borderColor: data.lastMonth.rows.map(r => DEPT_COLORS[r.dept]?.border ?? DEPT_COLORS.Other.border),
                borderWidth: 1, borderRadius: 4,
              }],
            },
            options: {
              indexAxis: 'y', responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${usd(ctx.parsed.x ?? 0)}` } } },
              scales: { x: { grid: { color: GRID }, ticks: { color: '#64748b', callback: usdTick } }, y: { grid: { display: false }, ticks: { color: '#94a3b8' } } },
            },
          })} />
        </Card>
      </div>

      {/* Sales & Lead Tracker */}
      <SectionTitle>Sales &amp; Lead Tracker</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <ChartHead title="Upsells vs New Sales" sub={`YTD ${year} · by Month ($ annual value)`} />
          <ChartCanvas make={c => new Chart(c, {
            type: 'bar',
            data: {
              labels: data.sales.labels,
              datasets: [
                { label: 'New Sales (Closed Won)', data: data.sales.won, backgroundColor: 'rgba(56,189,248,0.7)', borderColor: '#38bdf8', borderWidth: 1, borderRadius: 2 },
                { label: 'Upsells', data: data.sales.upsells, backgroundColor: 'rgba(139,92,246,0.7)', borderColor: '#8b5cf6', borderWidth: 1, borderRadius: 2 },
              ],
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${usd(ctx.parsed.y ?? 0)}` } } },
              scales: stackedScales,
            },
          })} />
          <div className="mt-2.5 flex flex-wrap gap-2.5">
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: '#38bdf8' }} />New Sales</span>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: '#8b5cf6' }} />Upsells</span>
          </div>
        </Card>
        <Card>
          <ChartHead title="Top Lead Sources" sub={`This month · ${data.leadSources.reduce((s, x) => s + x.n, 0)} leads`} />
          {data.leadSources.length === 0
            ? <div className="flex h-[220px] items-center justify-center text-sm text-slate-500">No leads yet this month</div>
            : <ChartCanvas make={c => new Chart(c, {
                type: 'doughnut',
                data: { labels: data.leadSources.map(d => d.src), datasets: [{ data: data.leadSources.map(d => d.n), backgroundColor: PIE_COLORS, borderColor: '#0b1929', borderWidth: 2, hoverOffset: 6 }] },
                options: {
                  responsive: true, maintainAspectRatio: false, cutout: '62%',
                  plugins: {
                    legend: { display: true, position: 'bottom', labels: { color: '#94a3b8', padding: 10, font: { size: 11 }, boxWidth: 10 } },
                    tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} leads` } },
                  },
                },
              })} />}
        </Card>
        <Card>
          <ChartHead title="Close Rate" sub="Trailing 6 weeks · % Closed Won" />
          <ChartCanvas make={c => new Chart(c, {
            type: 'bar',
            plugins: [{
              id: 'closeRateLabels',
              afterDatasetsDraw(chart) {
                const { ctx } = chart
                chart.getDatasetMeta(0).data.forEach((bar, i) => {
                  const v = closePcts[i]
                  ctx.save()
                  ctx.fillStyle = '#e2e8f0'
                  ctx.font = "bold 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
                  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
                  ctx.fillText(v + '%', bar.x, bar.y - 4)
                  ctx.restore()
                })
              },
            }],
            data: {
              labels: data.closeRate.map(d => d.week),
              datasets: [
                {
                  type: 'bar', label: 'Close Rate', data: closePcts,
                  backgroundColor: closePcts.map(p => p >= 70 ? 'rgba(34,197,94,0.75)' : p >= 60 ? 'rgba(245,158,11,0.75)' : 'rgba(248,113,113,0.75)'),
                  borderColor: closePcts.map(p => p >= 70 ? '#22c55e' : p >= 60 ? '#f59e0b' : '#f87171'),
                  borderWidth: 1, borderRadius: 4,
                },
                {
                  type: 'line', label: '70% Target', data: data.closeRate.map(() => 70),
                  borderColor: 'rgba(255,255,255,0.18)', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false,
                },
              ],
            },
            options: {
              responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24 } },
              plugins: {
                legend: { display: false },
                tooltip: { ...tooltipStyle, filter: item => item.datasetIndex === 0, callbacks: { label: ctx => { const d = data.closeRate[ctx.dataIndex]; return ` ${ctx.parsed.y}% — ${d.won} won of ${d.total} leads` } } },
              },
              scales: { x: { grid: { color: GRID }, ticks: { color: '#64748b' } }, y: { min: 0, max: 100, grid: { color: GRID }, ticks: { color: '#64748b', callback: v => v + '%' } } },
            },
          })} />
        </Card>
      </div>

      {/* Retention */}
      <SectionTitle>Customer Retention</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card>
          <ChartHead title="Recurring Retention Rate" sub="Recurring Services · all time" />
          <div className="flex flex-col items-center justify-center py-2.5">
            <div><span className="text-[52px] font-extrabold leading-none tracking-tight text-green-400">{data.retention.rate}</span><span className="text-2xl font-bold text-green-400">%</span></div>
            <div className="mt-2 text-center text-xs text-slate-500">{data.retention.total - data.retention.cancelled} retained of {data.retention.total} total recurring customers</div>
            <div className="my-3.5 h-2 w-full rounded-full bg-white/[0.07]"><div className="h-2 rounded-full bg-gradient-to-r from-green-500 to-green-400" style={{ width: `${data.retention.rate}%` }} /></div>
            <div className="mt-2 flex flex-wrap justify-center gap-3 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-green-400" />Active: {data.retention.active}</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-400" />Upgraded: {data.retention.upgraded}</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet-400" />Downgraded: {data.retention.downgraded}</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-400" />Cancelled: {data.retention.cancelled}</span>
            </div>
          </div>
        </Card>
        <Card>
          <ChartHead title="Recurring Customer Status" sub={`${data.retention.total} total recurring customers`} />
          <div className="flex items-center gap-6">
            <div className="w-[200px] flex-shrink-0">
              <ChartCanvas make={c => new Chart(c, {
                type: 'doughnut',
                data: { labels: ['Active', 'Upgraded', 'Downgraded', 'Cancelled'], datasets: [{ data: [data.retention.active, data.retention.upgraded, data.retention.downgraded, data.retention.cancelled], backgroundColor: ['#4ade80', '#38bdf8', '#a78bfa', '#f87171'], borderColor: '#0b1929', borderWidth: 3, hoverOffset: 6 }] },
                options: {
                  responsive: true, maintainAspectRatio: false, cutout: '65%',
                  plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} (${data.retention.total ? Math.round((ctx.parsed as number) / data.retention.total * 100) : 0}%)` } } },
                },
              })} />
            </div>
            <div className="flex-1 space-y-3">
              {([
                ['Active', data.retention.active, 'rgba(74,222,128,0.08)', 'rgba(74,222,128,0.2)', '#4ade80'],
                ['Upgraded', data.retention.upgraded, 'rgba(56,189,248,0.08)', 'rgba(56,189,248,0.2)', '#38bdf8'],
                ['Downgraded', data.retention.downgraded, 'rgba(167,139,250,0.08)', 'rgba(167,139,250,0.2)', '#a78bfa'],
                ['Cancelled', data.retention.cancelled, 'rgba(248,113,113,0.08)', 'rgba(248,113,113,0.2)', '#f87171'],
              ] as const).map(([label, n, bg, bd, dot]) => (
                <div key={label} className="flex items-center justify-between rounded-lg border px-3.5 py-2.5" style={{ background: bg, borderColor: bd }}>
                  <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} /><span className="text-[13px] text-slate-400">{label}</span></div>
                  <div className="text-right"><div className="text-xl font-bold" style={{ color: dot }}>{n}</div><div className="text-[11px] text-slate-500">{data.retention.total ? Math.round(n / data.retention.total * 100) : 0}%</div></div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-5 text-right text-[11px] text-slate-600">
        {meta.title} · Synced from Jobber + Lead Tracker · updated {new Date(data.asOf).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </div>
    </div>
  )
}

export default function Scoreboard1View({ meta }: { meta: ScoreboardMeta }) {
  const [snapshotId, setSnapshotId] = useState<string | null>(null)
  const { data, error, reload } = useScoreboardData<Payload>(meta.slug, snapshotId)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--t-well)] text-slate-200">
      <header className="flex items-center gap-3.5 border-b border-sky-400/15 bg-gradient-to-br from-[var(--t-panel)] to-[var(--t-sidebar)] px-5 py-4 max-md:pl-14">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-sky-400 text-lg">📊</div>
        <div>
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-sky-50">Scoreboards</h1>
            {meta.badge && <span className="rounded-full bg-sky-400/15 px-2 py-0.5 text-[11px] font-semibold text-sky-400">{meta.badge}</span>}
          </div>
          <div className="text-[13px] text-sky-300">Heroes Lawn Care · Live KPI Dashboard</div>
        </div>
      </header>

      <SnapshotControls slug={meta.slug} value={snapshotId} onChange={setSnapshotId} />

      {error
        ? <ScoreboardError error={error} onRetry={reload} />
        : !data
          ? <div className="px-6 py-16 text-center text-sm text-slate-500">Loading scoreboard…</div>
          : <Dashboard data={data} meta={meta} />}
    </div>
  )
}
