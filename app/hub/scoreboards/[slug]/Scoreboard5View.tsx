'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend,
} from 'chart.js'
import type { ScoreboardMeta } from '@/lib/scoreboards/registry'
import { useScoreboardData } from '@/hooks/use-scoreboard-data'
import ScoreboardError from '@/components/hub/ScoreboardError'
import SnapshotControls from '@/components/hub/scoreboards/SnapshotControls'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend)
Chart.defaults.color = '#64748b'
Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
Chart.defaults.font.size = 11

// ── Types (mirror the API payload from buildOfficeBoard) ──
type Payload = {
  asOf: string
  kpis: {
    leadsLastWeek: number
    closeRateYtd: number; ytdWon: number; ytdLost: number
    closeRateLastWeek: number; lwWon: number; lwLost: number
    kCloseRateLastWeek: number; kLwWon: number; kLwLost: number
    kSalesLastWeek: number
    companySalesYtd: number
    lastWeekLabel: string
  }
  leadSources: { src: string; won: number; lost: number }[]
  companyWeekly: { labels: string[]; won: number[]; upsells: number[] } // $ value
  katherineMonthly: { labels: string[]; won: number[]; upsells: number[] }
}

const GRID = 'rgba(255,255,255,0.06)'
const usd = (v: number) => '$' + Math.round(v).toLocaleString()
const usdTick = (v: number | string) => { const n = Number(v); return '$' + (n >= 1000 ? Math.round(n / 1000) + 'k' : n) }
// Close-rate band coloring (matches the Main board's 70 / 60 thresholds).
const rateColor = (p: number) => (p >= 70 ? '#22c55e' : p >= 60 ? '#f59e0b' : '#f87171')

const COLOR = {
  won: { bg: 'rgba(56,189,248,0.75)', border: '#38bdf8' },     // sky — Closed Won
  lost: { bg: 'rgba(248,113,113,0.75)', border: '#f87171' },   // red — Closed Lost
  upsell: { bg: 'rgba(139,92,246,0.75)', border: '#8b5cf6' },  // violet — Upsells
  wonGreen: { bg: 'rgba(34,197,94,0.75)', border: '#22c55e' }, // green — won (source chart)
}

const tooltipStyle = {
  backgroundColor: 'rgba(15,46,71,0.96)', borderColor: 'rgba(56,189,248,0.3)', borderWidth: 1,
  titleColor: '#bae6fd', bodyColor: '#94a3b8', padding: 10,
}
const countScales = {
  x: { stacked: true, grid: { color: GRID }, ticks: { color: '#64748b' } },
  y: { stacked: true, beginAtZero: true, grid: { color: GRID }, ticks: { color: '#64748b', precision: 0 } },
}
const usdScales = {
  x: { stacked: true, grid: { color: GRID }, ticks: { color: '#64748b' } },
  y: { stacked: true, beginAtZero: true, grid: { color: GRID }, ticks: { color: '#64748b', callback: usdTick } },
}

// Mount-once canvas (same pattern as the other boards).
function ChartCanvas({ make, height = 240 }: { make: (canvas: HTMLCanvasElement) => Chart; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const chart = make(ref.current)
    return () => chart.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
  return <div className="mt-8 mb-3.5 text-[11px] font-semibold uppercase tracking-[1.2px] text-gray-500 first:mt-0">{children}</div>
}
function ChartHead({ title, sub }: { title: string; sub: string }) {
  return (<><div className="text-[13px] font-semibold text-sky-200">{title}</div><div className="mb-3.5 text-[11px] text-gray-500">{sub}</div></>)
}
function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-2.5 flex flex-wrap gap-2.5">
      {items.map(i => (
        <span key={i.label} className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />{i.label}
        </span>
      ))}
    </div>
  )
}
// A KPI card whose big number can carry a band color (close-rate) or stay default.
function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: ReactNode; color?: string }) {
  return (
    <Card>
      <div className="text-[11px] font-medium text-sky-300">{label}</div>
      <div className="mt-1.5 text-[26px] font-bold leading-none tracking-tight" style={{ color: color ?? '#f0f9ff' }}>{value}</div>
      {sub != null && <div className="mt-1.5 text-[11px] text-gray-500">{sub}</div>}
    </Card>
  )
}

function Dashboard({ data, meta }: { data: Payload; meta: ScoreboardMeta }) {
  const { kpis } = data
  const year = new Date(data.asOf).getFullYear()
  const wk = kpis.lastWeekLabel

  return (
    <div className="mx-auto max-w-[1280px] px-4 md:px-6 pb-12 pt-2">
      {/* KPI summary */}
      <SectionTitle>This Week &amp; Year to Date</SectionTitle>
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-3">
        <Kpi label="Leads Last Week" value={kpis.leadsLastWeek.toLocaleString()} sub={`New leads · week of ${wk}`} />
        <Kpi label="Close Rate YTD" value={`${kpis.closeRateYtd}%`} color={rateColor(kpis.closeRateYtd)} sub={`${kpis.ytdWon} won / ${kpis.ytdLost} lost · leads from ${year}`} />
        <Kpi label="Close Rate Last Week" value={`${kpis.closeRateLastWeek}%`} color={rateColor(kpis.closeRateLastWeek)} sub={`${kpis.lwWon} won / ${kpis.lwLost} lost · leads in wk of ${wk}`} />
        <Kpi label="Kathryn — Close Rate Last Week" value={`${kpis.kCloseRateLastWeek}%`} color={rateColor(kpis.kCloseRateLastWeek)} sub={`${kpis.kLwWon} won / ${kpis.kLwLost} lost · leads in wk of ${wk}`} />
        <Kpi label="Kathryn — Sales Last Week" value={usd(kpis.kSalesLastWeek)} sub={`Closed Won + Upsells · week of ${wk}`} />
        <Kpi label="Company Sales YTD" value={usd(kpis.companySalesYtd)} sub={`Closed Won + Upsells · ${year}`} />
      </div>

      {/* Charts */}
      <SectionTitle>Lead Tracker</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Chart 1 — Top lead sources, stacked won vs lost */}
        <Card>
          <ChartHead title="Top Lead Sources" sub="This month · Closed Won vs Closed Lost" />
          {data.leadSources.length === 0
            ? <div className="flex h-[240px] items-center justify-center text-sm text-gray-500">No decided leads yet this month</div>
            : <>
                <ChartCanvas make={c => new Chart(c, {
                  type: 'bar',
                  data: {
                    labels: data.leadSources.map(d => d.src),
                    datasets: [
                      { label: 'Closed Won', data: data.leadSources.map(d => d.won), backgroundColor: COLOR.wonGreen.bg, borderColor: COLOR.wonGreen.border, borderWidth: 1, borderRadius: 2 },
                      { label: 'Closed Lost', data: data.leadSources.map(d => d.lost), backgroundColor: COLOR.lost.bg, borderColor: COLOR.lost.border, borderWidth: 1, borderRadius: 2 },
                    ],
                  },
                  options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y ?? 0}` } } },
                    scales: countScales,
                  },
                })} />
                <ChartLegend items={[{ label: 'Closed Won', color: COLOR.wonGreen.border }, { label: 'Closed Lost', color: COLOR.lost.border }]} />
              </>}
        </Card>

        {/* Chart 2 — Company sales per week, $ value, stacked won + upsells */}
        <Card>
          <ChartHead title="Company Sales per Week" sub="Trailing 6 weeks · $ Closed Won + Upsells" />
          <ChartCanvas make={c => new Chart(c, {
            type: 'bar',
            data: {
              labels: data.companyWeekly.labels,
              datasets: [
                { label: 'Closed Won', data: data.companyWeekly.won, backgroundColor: COLOR.won.bg, borderColor: COLOR.won.border, borderWidth: 1, borderRadius: 2 },
                { label: 'Upsells', data: data.companyWeekly.upsells, backgroundColor: COLOR.upsell.bg, borderColor: COLOR.upsell.border, borderWidth: 1, borderRadius: 2 },
              ],
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${usd(ctx.parsed.y ?? 0)}` } } },
              scales: usdScales,
            },
          })} />
          <ChartLegend items={[{ label: 'Closed Won', color: COLOR.won.border }, { label: 'Upsells', color: COLOR.upsell.border }]} />
        </Card>

        {/* Chart 3 — Katherine's monthly sales $, stacked won vs upsells */}
        <Card>
          <ChartHead title="Kathryn's Monthly Sales" sub="Trailing 4 months · $ annual value" />
          <ChartCanvas make={c => new Chart(c, {
            type: 'bar',
            data: {
              labels: data.katherineMonthly.labels,
              datasets: [
                { label: 'Closed Won', data: data.katherineMonthly.won, backgroundColor: COLOR.won.bg, borderColor: COLOR.won.border, borderWidth: 1, borderRadius: 2 },
                { label: 'Upsells', data: data.katherineMonthly.upsells, backgroundColor: COLOR.upsell.bg, borderColor: COLOR.upsell.border, borderWidth: 1, borderRadius: 2 },
              ],
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${usd(ctx.parsed.y ?? 0)}` } } },
              scales: usdScales,
            },
          })} />
          <ChartLegend items={[{ label: 'Closed Won', color: COLOR.won.border }, { label: 'Upsells', color: COLOR.upsell.border }]} />
        </Card>
      </div>

      <div className="mt-5 text-right text-[11px] text-gray-600">
        {meta.title} · Synced from the Lead Tracker · updated {new Date(data.asOf).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </div>
    </div>
  )
}

export default function Scoreboard5View({ meta }: { meta: ScoreboardMeta }) {
  const [snapshotId, setSnapshotId] = useState<string | null>(null)
  const { data, error, reload } = useScoreboardData<Payload>(meta.slug, snapshotId)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--t-well)] text-gray-200">
      <header className="flex items-center gap-3.5 border-b border-sky-400/15 bg-gradient-to-br from-[var(--t-panel)] to-[var(--t-sidebar)] px-5 py-4 max-md:pl-14">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-sky-400 text-lg">🏢</div>
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
          ? <div className="px-6 py-16 text-center text-sm text-gray-500">Loading scoreboard…</div>
          : <Dashboard data={data} meta={meta} />}
    </div>
  )
}
