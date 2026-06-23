'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Chart, BarController, BarElement, DoughnutController, ArcElement,
  CategoryScale, LinearScale, Tooltip, Legend,
} from 'chart.js'
import type { ScoreboardMeta } from '@/lib/scoreboards/registry'
import { useScoreboardData } from '@/hooks/use-scoreboard-data'
import ScoreboardError from '@/components/hub/ScoreboardError'
import SnapshotControls from '@/components/hub/scoreboards/SnapshotControls'

Chart.register(BarController, BarElement, DoughnutController, ArcElement, CategoryScale, LinearScale, Tooltip, Legend)
Chart.defaults.color = '#64748b'
Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
Chart.defaults.font.size = 11

// ── Types (mirror the API payload for board 2) ──
type DeptData = Record<string, number[]>
type Tech = {
  name: string
  depts: string[]
  weekly: { labels: string[]; data: DeptData }
  perHour: { revenue: number; hours: number; rate: number; weekLabel: string }
  sales: { labels: string[]; value: number[] }
}
type Payload = {
  asOf: string
  kpis: {
    totalJobs: number; avgValue: number; annualValue: number
    phcCount: number; phcPct: number; bwpCount: number; bwpPct: number
    addonCount: number; addonPct: number
  }
  weeklyRevenue: { labels: string[]; data: number[] }
  monthlyRevenue: { labels: string[]; data: number[] }
  programMix: { label: string; n: number }[]
  techs: Tech[]
}

// Department colors (shared convention with the Main Scoreboard).
const DEPT_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  WF: { bg: 'rgba(34,197,94,0.75)', border: '#22c55e', label: 'Lawn Care (WF)' },
  IR: { bg: 'rgba(14,165,233,0.75)', border: '#0ea5e9', label: 'Irrigation (IR)' },
  PW: { bg: 'rgba(245,158,11,0.75)', border: '#f59e0b', label: 'Pet Waste (PW)' },
  MO: { bg: 'rgba(139,92,246,0.75)', border: '#8b5cf6', label: 'Mosquito (MO)' },
  Other: { bg: 'rgba(100,116,139,0.75)', border: '#64748b', label: 'Other' },
}
// Lawn-health program tier colors (for the program-mix pie).
const TIER_COLORS: Record<string, string> = {
  Basic: '#22c55e', Complete: '#0ea5e9', Plus: '#8b5cf6', Recovery: '#f59e0b', Other: '#64748b',
}
const GRID = 'rgba(255,255,255,0.06)'
const WF_GREEN = { bg: 'rgba(34,197,94,0.75)', border: '#22c55e' }
const usd = (v: number) => '$' + Math.round(v).toLocaleString()
const usdTick = (v: number | string) => { const n = Number(v); return '$' + (n >= 1000 ? Math.round(n / 1000) + 'k' : n) }

const tooltipStyle = {
  backgroundColor: 'rgba(15,46,71,0.96)', borderColor: 'rgba(56,189,248,0.3)', borderWidth: 1,
  titleColor: '#bae6fd', bodyColor: '#94a3b8', padding: 10,
}
const barScales = {
  x: { grid: { color: GRID }, ticks: { color: '#64748b' } },
  y: { grid: { color: GRID }, ticks: { color: '#64748b', callback: usdTick }, beginAtZero: true },
}
const stackedScales = {
  x: { stacked: true, grid: { color: GRID }, ticks: { color: '#64748b' } },
  y: { stacked: true, grid: { color: GRID }, ticks: { color: '#64748b', callback: usdTick } },
}

// Mount-once canvas (parent renders only after data loads).
function ChartCanvas({ make, height = 220 }: { make: (canvas: HTMLCanvasElement) => Chart; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const chart = make(ref.current)
    return () => chart.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div className="relative w-full" style={{ height }}><canvas ref={ref} /></div>
}

// ── Layout primitives (match the Main Scoreboard) ──
function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-sky-400/12 bg-gradient-to-br from-[var(--t-panel)] to-[var(--t-sidebar)] p-5 ${className}`}>
      <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-500 via-emerald-400 to-transparent" />
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
function DeptLegends({ depts }: { depts: string[] }) {
  return (
    <div className="mt-2.5 flex flex-wrap gap-2.5">
      {depts.map(d => {
        const c = DEPT_COLORS[d] ?? DEPT_COLORS.Other
        return <span key={d} className="flex items-center gap-1.5 text-[11px] text-gray-400"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.border }} />{c.label}</span>
      })}
    </div>
  )
}
// KPI summary card.
function Kpi({ label, value, sub, badge, badgeColor = 'sky' }: { label: string; value: string; sub?: string; badge?: string; badgeColor?: 'sky' | 'green' | 'violet' }) {
  const badgeCls = badgeColor === 'green' ? 'bg-green-500/15 text-green-400'
    : badgeColor === 'violet' ? 'bg-violet-500/15 text-violet-400' : 'bg-sky-500/15 text-sky-400'
  return (
    <Card>
      <div className="text-[11px] font-medium text-emerald-300">{label}</div>
      <div className="mt-1.5 text-[26px] font-bold leading-none tracking-tight text-sky-50">{value}</div>
      {sub && <div className="mt-1.5 text-[11px] text-gray-500">{sub}</div>}
      {badge && <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${badgeCls}`}>{badge}</span>}
    </Card>
  )
}

function Dashboard({ data, meta }: { data: Payload; meta: ScoreboardMeta }) {
  const { kpis } = data
  const mixTotal = data.programMix.reduce((s, x) => s + x.n, 0)

  const deptDatasets = (series: DeptData, depts: string[]) => depts.map(d => ({
    label: DEPT_COLORS[d]?.label ?? d,
    data: series[d] ?? [],
    backgroundColor: DEPT_COLORS[d]?.bg, borderColor: DEPT_COLORS[d]?.border, borderWidth: 1, borderRadius: 2,
  }))

  return (
    <div className="mx-auto max-w-[1280px] px-4 md:px-6 pb-12 pt-2">
      {/* KPI summary */}
      <SectionTitle>WF at a Glance · Active Book</SectionTitle>
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-3">
        <Kpi label="Total WF Jobs" value={String(kpis.totalJobs)} sub="Active base programs" />
        <Kpi label="Average Job Value" value={usd(kpis.avgValue)} sub="Annual value per job" />
        <Kpi label="Total Annual Value" value={usd(kpis.annualValue)} sub="Active WF book" />
        <Kpi label="Plant Health Care" value={`${kpis.phcPct}%`} badge={`${kpis.phcCount} of ${kpis.totalJobs} jobs`} badgeColor="green" />
        <Kpi label="Bed Weed Prevention" value={`${kpis.bwpPct}%`} badge={`${kpis.bwpCount} of ${kpis.totalJobs} jobs`} badgeColor="violet" />
        <Kpi label="Jobs With an Add-On" value={String(kpis.addonCount)} sub="PHC, BWP, or both" badge={`${kpis.addonPct}% of WF jobs`} />
      </div>

      {/* WF visit revenue */}
      <SectionTitle>WF Visit Revenue</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <ChartHead title="Weekly Revenue" sub="Trailing 6 weeks · completed WF visits" />
          <ChartCanvas make={c => new Chart(c, {
            type: 'bar',
            data: { labels: data.weeklyRevenue.labels, datasets: [{ label: 'WF Revenue', data: data.weeklyRevenue.data, backgroundColor: WF_GREEN.bg, borderColor: WF_GREEN.border, borderWidth: 1, borderRadius: 4 }] },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${usd(ctx.parsed.y ?? 0)}` } } },
              scales: barScales,
            },
          })} />
        </Card>
        <Card>
          <ChartHead title="Monthly Revenue" sub="Trailing 4 months · completed WF visits" />
          <ChartCanvas make={c => new Chart(c, {
            type: 'bar',
            data: { labels: data.monthlyRevenue.labels, datasets: [{ label: 'WF Revenue', data: data.monthlyRevenue.data, backgroundColor: WF_GREEN.bg, borderColor: WF_GREEN.border, borderWidth: 1, borderRadius: 4 }] },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${usd(ctx.parsed.y ?? 0)}` } } },
              scales: barScales,
            },
          })} />
        </Card>
      </div>

      {/* Program mix */}
      <SectionTitle>Program Mix · Active Book</SectionTitle>
      <Card>
        <ChartHead title="Lawn Health Program Mix" sub={`${mixTotal} active WF base programs`} />
        {data.programMix.length === 0
          ? <div className="flex h-[220px] items-center justify-center text-sm text-gray-500">No active WF programs</div>
          : <div className="flex flex-col items-center gap-6 sm:flex-row">
              <div className="w-[220px] flex-shrink-0">
                <ChartCanvas make={c => new Chart(c, {
                  type: 'doughnut',
                  data: { labels: data.programMix.map(p => p.label), datasets: [{ data: data.programMix.map(p => p.n), backgroundColor: data.programMix.map(p => TIER_COLORS[p.label] ?? TIER_COLORS.Other), borderColor: '#0b1929', borderWidth: 3, hoverOffset: 6 }] },
                  options: {
                    responsive: true, maintainAspectRatio: false, cutout: '60%',
                    plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} (${mixTotal ? Math.round((ctx.parsed as number) / mixTotal * 100) : 0}%)` } } },
                  },
                })} />
              </div>
              <div className="flex-1 space-y-2.5 self-stretch">
                {data.programMix.map(p => (
                  <div key={p.label} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-3.5 py-2.5">
                    <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: TIER_COLORS[p.label] ?? TIER_COLORS.Other }} /><span className="text-[13px] text-gray-300">{p.label}</span></div>
                    <div className="text-right"><span className="text-lg font-bold" style={{ color: TIER_COLORS[p.label] ?? TIER_COLORS.Other }}>{p.n}</span><span className="ml-2 text-[11px] text-gray-500">{mixTotal ? Math.round(p.n / mixTotal * 100) : 0}%</span></div>
                  </div>
                ))}
              </div>
            </div>}
      </Card>

      {/* Technicians */}
      <SectionTitle>Technicians</SectionTitle>
      {data.techs.length === 0
        ? <Card><div className="py-8 text-center text-sm text-gray-500">No WF technicians found. (Tag a teammate&apos;s job title with “WF” to track them here.)</div></Card>
        : data.techs.map(tech => (
            <div key={tech.name} className="mb-5">
              <div className="mb-3 flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-400 text-[11px] font-bold text-emerald-950">{tech.name.split(' ').map(p => p[0]).slice(0, 2).join('')}</div>
                <span className="text-[15px] font-semibold text-sky-100">{tech.name}</span>
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                {/* Weekly revenue stacked by dept */}
                <Card>
                  <ChartHead title="Weekly Revenue" sub="Trailing 6 weeks · all departments" />
                  {tech.depts.length === 0
                    ? <div className="flex h-[220px] items-center justify-center text-sm text-gray-500">No completed visits</div>
                    : <><ChartCanvas make={c => new Chart(c, {
                        type: 'bar',
                        data: { labels: tech.weekly.labels, datasets: deptDatasets(tech.weekly.data, tech.depts) },
                        options: {
                          responsive: true, maintainAspectRatio: false,
                          plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${usd(ctx.parsed.y ?? 0)}` } } },
                          scales: stackedScales,
                        },
                      })} />
                      <DeptLegends depts={tech.depts} /></>}
                </Card>
                {/* $/hour last week */}
                <Card>
                  <ChartHead title="Revenue per Hour" sub={`Last week · ${tech.perHour.weekLabel}`} />
                  <div className="flex h-[220px] flex-col items-center justify-center">
                    <div><span className="text-[52px] font-extrabold leading-none tracking-tight text-emerald-400">{usd(tech.perHour.rate)}</span><span className="text-xl font-bold text-emerald-400">/hr</span></div>
                    <div className="mt-3 text-center text-xs text-gray-500">{usd(tech.perHour.revenue)} revenue ÷ {tech.perHour.hours} hrs</div>
                    {tech.perHour.hours === 0 && <div className="mt-2 text-center text-[11px] text-gray-600">No hours logged last week</div>}
                  </div>
                </Card>
                {/* Sales $ per week */}
                <Card>
                  <ChartHead title="Sales per Week" sub="Trailing 6 weeks · closed-won value" />
                  <ChartCanvas make={c => new Chart(c, {
                    type: 'bar',
                    data: { labels: tech.sales.labels, datasets: [{ label: 'Sales', data: tech.sales.value, backgroundColor: 'rgba(56,189,248,0.7)', borderColor: '#38bdf8', borderWidth: 1, borderRadius: 4 }] },
                    options: {
                      responsive: true, maintainAspectRatio: false,
                      plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${usd(ctx.parsed.y ?? 0)}` } } },
                      scales: barScales,
                    },
                  })} />
                </Card>
              </div>
            </div>
          ))}

      <div className="mt-5 text-right text-[11px] text-gray-600">
        {meta.title} · Synced from Jobber + Recurring Services + Lead Tracker + Timesheets · updated {new Date(data.asOf).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </div>
    </div>
  )
}

export default function Scoreboard2View({ meta }: { meta: ScoreboardMeta }) {
  const [snapshotId, setSnapshotId] = useState<string | null>(null)
  const { data, error, reload } = useScoreboardData<Payload>(meta.slug, snapshotId)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--t-well)] text-gray-200">
      <header className="flex items-center gap-3.5 border-b border-emerald-400/15 bg-gradient-to-br from-[var(--t-panel)] to-[var(--t-sidebar)] px-5 py-4 max-md:pl-14">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-400 text-lg">🌱</div>
        <div>
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-sky-50">{meta.title}</h1>
            {meta.badge && <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">{meta.badge}</span>}
          </div>
          <div className="text-[13px] text-emerald-300">Heroes Lawn Care · Weed &amp; Fert KPIs</div>
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
