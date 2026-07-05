'use client'

import { useState, type ReactNode } from 'react'
import {
  Chart, BarController, BarElement, CategoryScale, LinearScale,
  DoughnutController, ArcElement, Tooltip, Legend,
} from 'chart.js'
import type { ScoreboardMeta } from '@/lib/scoreboards/registry'
import { useScoreboardData } from '@/hooks/use-scoreboard-data'
import ScoreboardError from '@/components/hub/ScoreboardError'
import SnapshotControls from '@/components/hub/scoreboards/SnapshotControls'
import { ChartCanvas } from '@/components/hub/scoreboards/ChartCanvas'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, DoughnutController, ArcElement, Tooltip, Legend)
Chart.defaults.color = '#64748b'
Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
Chart.defaults.font.size = 11

// ── Types (mirror the API payload from buildRetentionBoard) ──
type Payload = {
  asOf: string
  year: number
  active_now: number; upgraded: number; downgraded: number
  new_in_year: number; start_of_year: number
  churned_gross: number; churned_controllable: number
  churned_company_initiated: number; churned_uncontrollable: number; churned_review: number
  churned_annual_value: number; active_annual_value: number
  gross_churn_pct: number | null; controllable_churn_pct: number | null
  by_reason: { reason: string; churn_type: string; count: number; annual_value: number }[]
  by_type: { churn_type: string; count: number; annual_value: number }[]
  monthly: { month: string; gross: number; controllable: number }[]
  insights: string[]
}

const GRID = 'rgba(255,255,255,0.06)'
const usd = (v: number) => '$' + Math.round(v).toLocaleString()
// Retention band: ≥90 green / ≥82 amber / below red (recurring lawn-care norms).
const retColor = (p: number) => (p >= 90 ? '#22c55e' : p >= 82 ? '#f59e0b' : '#f87171')

// One color per churn type — reused by the donut, the reason bars and the legend.
const TYPE_COLOR: Record<string, { bg: string; border: string }> = {
  'Controllable':      { bg: 'rgba(248,113,113,0.75)', border: '#f87171' }, // red — the one to fight
  'Uncontrollable':    { bg: 'rgba(148,163,184,0.6)',  border: '#94a3b8' }, // slate — life happens
  'Company-Initiated': { bg: 'rgba(139,92,246,0.75)',  border: '#8b5cf6' }, // violet — we chose it
  'Review':            { bg: 'rgba(245,158,11,0.7)',   border: '#f59e0b' }, // amber — needs a reason
  'Not Churn':         { bg: 'rgba(56,189,248,0.7)',   border: '#38bdf8' },
}
const typeColor = (t: string) => TYPE_COLOR[t] ?? TYPE_COLOR['Review']

const tooltipStyle = {
  backgroundColor: 'rgba(15,46,71,0.96)', borderColor: 'rgba(56,189,248,0.3)', borderWidth: 1,
  titleColor: '#bae6fd', bodyColor: '#94a3b8', padding: 10,
}

// ── Layout primitives (Scoreboards house style) ──
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
  const retention = data.gross_churn_pct != null ? Math.round((100 - data.gross_churn_pct) * 10) / 10 : null
  const net = data.new_in_year - data.churned_gross

  // Floating-bar waterfall: Start → +New → −Lost → Now. Each bar is a [low, high] span.
  const wfStart = data.start_of_year
  const wfAfterNew = wfStart + data.new_in_year
  const waterfall = {
    labels: [`Start of ${data.year}`, '+ New', '− Cancelled', 'Today'],
    spans: [[0, wfStart], [wfStart, wfAfterNew], [data.active_now, wfAfterNew], [0, data.active_now]] as [number, number][],
    colors: ['rgba(56,189,248,0.7)', 'rgba(34,197,94,0.75)', 'rgba(248,113,113,0.75)', 'rgba(56,189,248,0.7)'],
    borders: ['#38bdf8', '#22c55e', '#f87171', '#38bdf8'],
    deltas: [wfStart, data.new_in_year, -data.churned_gross, data.active_now],
  }

  const monthLabels = data.monthly.map(m => new Date(m.month + '-15').toLocaleString('en-US', { month: 'short' }))

  return (
    <div className="mx-auto max-w-[1280px] px-4 md:px-6 pb-12 pt-2">
      {/* KPI summary */}
      <SectionTitle>{data.year} Recurring Book — Year to Date</SectionTitle>
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Kpi
          label="Gross Retention"
          value={retention != null ? `${retention}%` : '—'}
          color={retention != null ? retColor(retention) : undefined}
          sub={`${data.churned_gross} of ${data.start_of_year} services lost YTD`}
        />
        <Kpi
          label="Controllable Churn"
          value={data.controllable_churn_pct != null ? `${data.controllable_churn_pct}%` : '—'}
          color={data.controllable_churn_pct != null ? (data.controllable_churn_pct <= 4 ? '#22c55e' : data.controllable_churn_pct <= 8 ? '#f59e0b' : '#f87171') : undefined}
          sub={`${data.churned_controllable} cancels we could have influenced`}
        />
        <Kpi
          label="Active Recurring Services"
          value={data.active_now.toLocaleString()}
          sub={<>+{data.new_in_year} new · −{data.churned_gross} lost · net {net >= 0 ? '+' : ''}{net} · {data.upgraded} upgraded</>}
        />
        <Kpi
          label="Annual Value Lost"
          value={usd(data.churned_annual_value)}
          color="#f87171"
          sub={`vs ${usd(data.active_annual_value)} active on the books`}
        />
      </div>

      {/* Insights */}
      {data.insights.length > 0 && (
        <>
          <SectionTitle>What the Numbers Say</SectionTitle>
          <Card>
            <ul className="space-y-2">
              {data.insights.map((line, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-snug text-gray-300">
                  <span className="shrink-0">💡</span><span>{line}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {/* Charts */}
      <SectionTitle>Where &amp; Why We Lose Customers</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Chart 1 — Monthly churn trend */}
        <Card>
          <ChartHead title="Cancellations by Month" sub={`${data.year} · gross vs controllable`} />
          {data.monthly.length === 0
            ? <div className="flex h-[240px] items-center justify-center text-sm text-gray-500">No cancellations recorded this year 🎉</div>
            : <>
                <ChartCanvas make={c => new Chart(c, {
                  type: 'bar',
                  data: {
                    labels: monthLabels,
                    datasets: [
                      { label: 'All cancellations', data: data.monthly.map(m => m.gross), backgroundColor: 'rgba(148,163,184,0.55)', borderColor: '#94a3b8', borderWidth: 1, borderRadius: 2 },
                      { label: 'Controllable', data: data.monthly.map(m => m.controllable), backgroundColor: TYPE_COLOR['Controllable'].bg, borderColor: TYPE_COLOR['Controllable'].border, borderWidth: 1, borderRadius: 2 },
                    ],
                  },
                  options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: tooltipStyle && { ...tooltipStyle } },
                    scales: {
                      x: { grid: { color: GRID }, ticks: { color: '#64748b' } },
                      y: { beginAtZero: true, grid: { color: GRID }, ticks: { color: '#64748b', precision: 0 } },
                    },
                  },
                })} />
                <ChartLegend items={[{ label: 'All cancellations', color: '#94a3b8' }, { label: 'Controllable', color: TYPE_COLOR['Controllable'].border }]} />
              </>}
        </Card>

        {/* Chart 2 — Customer waterfall */}
        <Card>
          <ChartHead title="Recurring Services Waterfall" sub={`Start of ${data.year} → today`} />
          <ChartCanvas make={c => new Chart(c, {
            type: 'bar',
            data: {
              labels: waterfall.labels,
              datasets: [{
                label: 'Services',
                data: waterfall.spans,
                backgroundColor: waterfall.colors,
                borderColor: waterfall.borders,
                borderWidth: 1, borderRadius: 3, borderSkipped: false,
              }],
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: { ...tooltipStyle, callbacks: { label: ctx => { const d = waterfall.deltas[ctx.dataIndex]; return ` ${d > 0 && ctx.dataIndex !== 0 && ctx.dataIndex !== 3 ? '+' : ''}${d}` } } },
              },
              scales: {
                x: { grid: { color: GRID }, ticks: { color: '#64748b' } },
                y: { beginAtZero: true, grid: { color: GRID }, ticks: { color: '#64748b', precision: 0 } },
              },
            },
          })} />
        </Card>

        {/* Chart 3 — Churn by type donut */}
        <Card>
          <ChartHead title="Churn by Type" sub="Controllable is the number to manage against" />
          {data.by_type.length === 0
            ? <div className="flex h-[240px] items-center justify-center text-sm text-gray-500">No cancellations this year</div>
            : <>
                <ChartCanvas make={c => new Chart(c, {
                  type: 'doughnut',
                  data: {
                    labels: data.by_type.map(t => t.churn_type),
                    datasets: [{
                      data: data.by_type.map(t => t.count),
                      backgroundColor: data.by_type.map(t => typeColor(t.churn_type).bg),
                      borderColor: data.by_type.map(t => typeColor(t.churn_type).border),
                      borderWidth: 1,
                    }],
                  },
                  options: {
                    responsive: true, maintainAspectRatio: false, cutout: '58%',
                    plugins: {
                      legend: { display: false },
                      tooltip: { ...tooltipStyle, callbacks: { label: ctx => { const t = data.by_type[ctx.dataIndex]; return ` ${t.churn_type}: ${t.count} (${usd(t.annual_value)}/yr)` } } },
                    },
                  },
                })} />
                <ChartLegend items={data.by_type.map(t => ({ label: `${t.churn_type} (${t.count})`, color: typeColor(t.churn_type).border }))} />
              </>}
        </Card>

        {/* Chart 4 — Churn by reason, horizontal, colored by type */}
        <Card>
          <ChartHead title="Churn by Reason" sub="Every cancellation this year, by master reason" />
          {data.by_reason.length === 0
            ? <div className="flex h-[240px] items-center justify-center text-sm text-gray-500">No cancellations this year</div>
            : <>
                <ChartCanvas make={c => new Chart(c, {
                  type: 'bar',
                  data: {
                    labels: data.by_reason.map(r => r.reason),
                    datasets: [{
                      label: 'Cancellations',
                      data: data.by_reason.map(r => r.count),
                      backgroundColor: data.by_reason.map(r => typeColor(r.churn_type).bg),
                      borderColor: data.by_reason.map(r => typeColor(r.churn_type).border),
                      borderWidth: 1, borderRadius: 2,
                    }],
                  },
                  options: {
                    indexAxis: 'y' as const,
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      tooltip: { ...tooltipStyle, callbacks: { label: ctx => { const r = data.by_reason[ctx.dataIndex]; return ` ${r.count} · ${r.churn_type} · ${usd(r.annual_value)}/yr` } } },
                    },
                    scales: {
                      x: { beginAtZero: true, grid: { color: GRID }, ticks: { color: '#64748b', precision: 0 } },
                      y: { grid: { display: false }, ticks: { color: '#94a3b8', autoSkip: false, font: { size: 10 } } },
                    },
                  },
                })} />
                <ChartLegend items={Object.entries(TYPE_COLOR).filter(([t]) => data.by_reason.some(r => r.churn_type === t)).map(([t, c]) => ({ label: t, color: c.border }))} />
              </>}
        </Card>
      </div>

      <div className="mt-5 text-right text-[11px] text-gray-600">
        {meta.title} · Recurring Services board, {data.year} cancellations only · updated {new Date(data.asOf).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </div>
    </div>
  )
}

export default function Scoreboard7View({ meta }: { meta: ScoreboardMeta }) {
  const [snapshotId, setSnapshotId] = useState<string | null>(null)
  const { data, error, reload } = useScoreboardData<Payload>(meta.slug, snapshotId)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--t-well)] text-gray-200">
      <header className="flex items-center gap-3.5 border-b border-sky-400/15 bg-gradient-to-br from-[var(--t-panel)] to-[var(--t-sidebar)] px-5 py-4 max-md:pl-14">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-sky-400 text-lg">🔄</div>
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
