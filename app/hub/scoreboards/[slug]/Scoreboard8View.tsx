'use client'

import { useMemo, useState, type ReactNode } from 'react'
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

// ── Types (mirror the API payload from buildLeadSourceBoard) ──
type ScorecardRow = {
  source: string; source_group: string; cost_type: string
  total_customers: number; active_count: number; churned_count: number
  retention_pct: number | null; new_in_year: number
  active_annual_value: number; avg_annual_value: number | null
  avg_tenure_months: number | null; est_ltv: number | null
  unresolved_count: number
}
type Payload = {
  asOf: string
  year: number
  scorecard: ScorecardRow[]
  closeRates: { src: string; won: number; lost: number; rate: number }[]
  coveragePct: number
  mix: Record<string, number>
  insights: string[]
}

const GRID = 'rgba(255,255,255,0.06)'
const usd = (v: number) => '$' + Math.round(v).toLocaleString()
const retColor = (p: number) => (p >= 90 ? '#22c55e' : p >= 80 ? '#f59e0b' : '#f87171')

const COST_COLOR: Record<string, { bg: string; border: string }> = {
  Paid:    { bg: 'rgba(248,113,113,0.7)', border: '#f87171' },
  Free:    { bg: 'rgba(34,197,94,0.7)',   border: '#22c55e' },
  Mixed:   { bg: 'rgba(139,92,246,0.7)',  border: '#8b5cf6' },
  Unknown: { bg: 'rgba(148,163,184,0.5)', border: '#94a3b8' },
}
const costColor = (t: string) => COST_COLOR[t] ?? COST_COLOR.Unknown

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

// ── Scorecard table (click a header to re-sort) ──
type SortKey = 'total_customers' | 'retention_pct' | 'new_in_year' | 'active_annual_value' | 'avg_tenure_months' | 'est_ltv'

function ScorecardTable({ rows }: { rows: ScorecardRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('total_customers')
  const sorted = useMemo(
    () => [...rows].sort((a, b) => ((b[sortKey] ?? -1) as number) - ((a[sortKey] ?? -1) as number)),
    [rows, sortKey],
  )
  const Th = ({ k, children, title }: { k?: SortKey; children: ReactNode; title?: string }) => (
    <th
      title={title}
      onClick={k ? () => setSortKey(k) : undefined}
      className={`whitespace-nowrap px-2.5 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wide first:text-left ${k ? 'cursor-pointer select-none hover:text-sky-300' : ''} ${k === sortKey ? 'text-sky-300' : 'text-gray-500'}`}
    >
      {children}{k === sortKey ? ' ▾' : ''}
    </th>
  )
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-sky-400/15">
            <Th>Source</Th>
            <Th k="total_customers" title="Recurring customers attributed to this source (active + cancelled this year)">Customers</Th>
            <Th>Active</Th>
            <Th>Lost</Th>
            <Th k="retention_pct" title="Share of this source's customers still active">Retention</Th>
            <Th k="new_in_year">New</Th>
            <Th k="active_annual_value" title="Annual value of this source's active services">Active $/yr</Th>
            <Th k="avg_tenure_months" title="Average customer age (months) — includes still-active customers">Tenure</Th>
            <Th k="est_ltv" title="Estimated lifetime value: avg annual $ × avg tenure in years">Est. LTV</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={r.source} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
              <td className="max-w-[220px] px-2.5 py-2">
                <div className="truncate font-medium text-gray-200">{r.source}</div>
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: costColor(r.cost_type).border }} />
                  {r.cost_type} · {r.source_group}
                </div>
              </td>
              <td className="px-2.5 py-2 text-right text-gray-300">{r.total_customers}</td>
              <td className="px-2.5 py-2 text-right text-gray-300">{r.active_count}</td>
              <td className="px-2.5 py-2 text-right" style={{ color: r.churned_count > 0 ? '#f87171' : '#4b5563' }}>{r.churned_count}</td>
              <td className="px-2.5 py-2 text-right font-semibold" style={{ color: r.retention_pct != null ? retColor(r.retention_pct) : '#4b5563' }}>
                {r.retention_pct != null ? `${r.retention_pct}%` : '—'}
              </td>
              <td className="px-2.5 py-2 text-right text-gray-300">{r.new_in_year}</td>
              <td className="px-2.5 py-2 text-right text-gray-300">{usd(r.active_annual_value)}</td>
              <td className="px-2.5 py-2 text-right text-gray-400">{r.avg_tenure_months != null ? `${r.avg_tenure_months} mo` : '—'}</td>
              <td className="px-2.5 py-2 text-right font-semibold text-sky-200">{r.est_ltv != null ? usd(r.est_ltv) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Dashboard({ data, meta }: { data: Payload; meta: ScoreboardMeta }) {
  const newTotal = data.scorecard.reduce((s, r) => s + r.new_in_year, 0)
  const paidNew = data.mix['Paid'] ?? 0
  const freeNew = (data.mix['Free'] ?? 0)
  const paidSharePct = newTotal > 0 ? Math.round((100 * paidNew) / newTotal) : 0

  const rated = data.scorecard.filter(r => r.source !== 'Other / Unknown' && r.total_customers >= 5 && r.retention_pct != null)
  const best = [...rated].sort((a, b) => (b.retention_pct ?? 0) - (a.retention_pct ?? 0))[0] ?? null

  const bySourceNew = data.scorecard.filter(r => r.new_in_year > 0).sort((a, b) => b.new_in_year - a.new_in_year).slice(0, 8)
  const retentionRows = data.scorecard.filter(r => r.source !== 'Other / Unknown' && r.total_customers >= 3 && r.retention_pct != null)
    .sort((a, b) => (b.retention_pct ?? 0) - (a.retention_pct ?? 0))
  const mixEntries = Object.entries(data.mix).filter(([, n]) => n > 0)

  return (
    <div className="mx-auto max-w-[1280px] px-4 md:px-6 pb-12 pt-2">
      {/* KPI summary */}
      <SectionTitle>{data.year} — Where Customers Come From</SectionTitle>
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Kpi label={`New Recurring Customers ${data.year}`} value={newTotal.toLocaleString()} sub="Sold this year, on the Recurring board" />
        <Kpi
          label="Paid vs Free Mix"
          value={`${paidSharePct}% paid`}
          sub={`${paidNew} paid · ${freeNew} free/referral of ${newTotal} new`}
        />
        <Kpi
          label="Best-Retaining Source"
          value={best ? best.source : '—'}
          color="#22c55e"
          sub={best ? `${best.retention_pct}% retained · ${best.total_customers} customers` : 'Need ≥5 customers per source'}
        />
        <Kpi
          label="Source Coverage"
          value={`${data.coveragePct}%`}
          color={data.coveragePct >= 85 ? '#22c55e' : data.coveragePct >= 65 ? '#f59e0b' : '#f87171'}
          sub="Share of the book with a known lead source"
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

      {/* The scorecard */}
      <SectionTitle>Lead-Source Scorecard — Volume, Value &amp; Loyalty</SectionTitle>
      <Card>
        <ScorecardTable rows={data.scorecard} />
        <div className="mt-3 text-[10.5px] leading-snug text-gray-600">
          Universe: this year&apos;s recurring book (active + cancelled in {data.year}). Retention here is the share still active — young sources look better than old ones,
          so read it alongside tenure. Est. LTV = avg annual $ × avg tenure. Sources are only as accurate as the &quot;HLC105 Lead Source&quot; field on the client.
        </div>
      </Card>

      {/* Charts */}
      <SectionTitle>Source Performance</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Chart 1 — New customers by source */}
        <Card>
          <ChartHead title="New Customers by Source" sub={`${data.year} · recurring services sold`} />
          {bySourceNew.length === 0
            ? <div className="flex h-[240px] items-center justify-center text-sm text-gray-500">No new recurring customers yet</div>
            : <ChartCanvas make={c => new Chart(c, {
                type: 'bar',
                data: {
                  labels: bySourceNew.map(r => r.source),
                  datasets: [{
                    label: 'New customers',
                    data: bySourceNew.map(r => r.new_in_year),
                    backgroundColor: bySourceNew.map(r => costColor(r.cost_type).bg),
                    borderColor: bySourceNew.map(r => costColor(r.cost_type).border),
                    borderWidth: 1, borderRadius: 2,
                  }],
                },
                options: {
                  indexAxis: 'y' as const,
                  responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { display: false }, tooltip: { ...tooltipStyle } },
                  scales: {
                    x: { beginAtZero: true, grid: { color: GRID }, ticks: { color: '#64748b', precision: 0 } },
                    y: { grid: { display: false }, ticks: { color: '#94a3b8', autoSkip: false, font: { size: 10 } } },
                  },
                },
              })} />}
        </Card>

        {/* Chart 2 — Retention by source */}
        <Card>
          <ChartHead title="Retention by Source" sub="Sources with ≥3 recurring customers" />
          {retentionRows.length === 0
            ? <div className="flex h-[240px] items-center justify-center text-sm text-gray-500">Not enough attributed customers yet</div>
            : <ChartCanvas make={c => new Chart(c, {
                type: 'bar',
                data: {
                  labels: retentionRows.map(r => r.source),
                  datasets: [{
                    label: 'Retention %',
                    data: retentionRows.map(r => r.retention_pct),
                    backgroundColor: retentionRows.map(r => retColor(r.retention_pct ?? 0) + 'b3'),
                    borderColor: retentionRows.map(r => retColor(r.retention_pct ?? 0)),
                    borderWidth: 1, borderRadius: 2,
                  }],
                },
                options: {
                  indexAxis: 'y' as const,
                  responsive: true, maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: { ...tooltipStyle, callbacks: { label: ctx => { const r = retentionRows[ctx.dataIndex]; return ` ${r.retention_pct}% · ${r.active_count} active / ${r.churned_count} lost of ${r.total_customers}` } } },
                  },
                  scales: {
                    x: { beginAtZero: true, max: 100, grid: { color: GRID }, ticks: { color: '#64748b', callback: v => v + '%' } },
                    y: { grid: { display: false }, ticks: { color: '#94a3b8', autoSkip: false, font: { size: 10 } } },
                  },
                },
              })} />}
        </Card>

        {/* Chart 3 — Close rate by source (Lead Tracker) */}
        <Card>
          <ChartHead title="Close Rate by Source" sub={`Lead Tracker · leads created in ${data.year}`} />
          {data.closeRates.length === 0
            ? <div className="flex h-[240px] items-center justify-center text-sm text-gray-500">No decided leads yet this year</div>
            : <>
                <ChartCanvas make={c => new Chart(c, {
                  type: 'bar',
                  data: {
                    labels: data.closeRates.map(d => d.src),
                    datasets: [
                      { label: 'Closed Won', data: data.closeRates.map(d => d.won), backgroundColor: 'rgba(34,197,94,0.75)', borderColor: '#22c55e', borderWidth: 1, borderRadius: 2 },
                      { label: 'Closed Lost', data: data.closeRates.map(d => d.lost), backgroundColor: 'rgba(248,113,113,0.75)', borderColor: '#f87171', borderWidth: 1, borderRadius: 2 },
                    ],
                  },
                  options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      tooltip: { ...tooltipStyle, callbacks: { afterTitle: items => { const d = data.closeRates[items[0].dataIndex]; return `${d.rate}% close rate` } } },
                    },
                    scales: {
                      x: { stacked: true, grid: { color: GRID }, ticks: { color: '#64748b', font: { size: 9 } } },
                      y: { stacked: true, beginAtZero: true, grid: { color: GRID }, ticks: { color: '#64748b', precision: 0 } },
                    },
                  },
                })} />
                <ChartLegend items={[{ label: 'Closed Won', color: '#22c55e' }, { label: 'Closed Lost', color: '#f87171' }]} />
              </>}
        </Card>

        {/* Chart 4 — Paid vs Free mix donut */}
        <Card className="lg:col-span-3">
          <div className="grid items-center gap-4 md:grid-cols-[240px_1fr]">
            <div className="h-[180px]">
              {mixEntries.length === 0
                ? <div className="flex h-full items-center justify-center text-sm text-gray-500">No new customers yet</div>
                : <ChartCanvas make={c => new Chart(c, {
                    type: 'doughnut',
                    data: {
                      labels: mixEntries.map(([t]) => t),
                      datasets: [{
                        data: mixEntries.map(([, n]) => n),
                        backgroundColor: mixEntries.map(([t]) => costColor(t).bg),
                        borderColor: mixEntries.map(([t]) => costColor(t).border),
                        borderWidth: 1,
                      }],
                    },
                    options: {
                      responsive: true, maintainAspectRatio: false, cutout: '58%',
                      plugins: { legend: { display: false }, tooltip: { ...tooltipStyle } },
                    },
                  })} />}
            </div>
            <div>
              <ChartHead title="Paid vs Free — New Customers" sub={`${data.year} acquisition mix by cost type`} />
              <ChartLegend items={mixEntries.map(([t, n]) => ({ label: `${t} (${n})`, color: costColor(t).border }))} />
              <div className="mt-3 text-[12px] leading-snug text-gray-400">
                Free &amp; referral customers cost nothing to acquire and historically retain best — every point of mix shifted from Paid to
                Free/Referral is margin. Google (GBP / LSA) is Mixed because organic GBP and paid LSA can&apos;t be separated at intake.
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-5 text-right text-[11px] text-gray-600">
        {meta.title} · HLC105 Lead Source + Recurring Services board + Lead Tracker · updated {new Date(data.asOf).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </div>
    </div>
  )
}

export default function Scoreboard8View({ meta }: { meta: ScoreboardMeta }) {
  const [snapshotId, setSnapshotId] = useState<string | null>(null)
  const { data, error, reload } = useScoreboardData<Payload>(meta.slug, snapshotId)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--t-well)] text-gray-200">
      <header className="flex items-center gap-3.5 border-b border-sky-400/15 bg-gradient-to-br from-[var(--t-panel)] to-[var(--t-sidebar)] px-5 py-4 max-md:pl-14">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-sky-400 text-lg">🧭</div>
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
