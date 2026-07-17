'use client'

import { useState, type ReactNode } from 'react'
import {
  Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend,
} from 'chart.js'
import type { ScoreboardMeta } from '@/lib/scoreboards/registry'
import { useScoreboardData } from '@/hooks/use-scoreboard-data'
import ScoreboardError from '@/components/hub/ScoreboardError'
import SnapshotControls from '@/components/hub/scoreboards/SnapshotControls'
import { ChartCanvas } from '@/components/hub/scoreboards/ChartCanvas'
import { formatCurrency } from '@/lib/format'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend)
Chart.defaults.color = '#64748b'
Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
Chart.defaults.font.size = 11

// ── Types (mirror the API payload for board 4) ──
type DeptData = Record<string, number[]>
type ByTech = { labels: string[]; techs: { name: string; data: number[] }[]; other: number[] | null }
type TechPerf = {
  name: string
  depts: string[]
  monthDepts: string[]
  weekly: { labels: string[]; data: DeptData }
  monthly: { labels: string[]; data: DeptData }
  perHour: { revenue: number; hours: number; rate: number; weekLabel: string }
}
type Payload = {
  asOf: string
  kpis: { activeCustomers: number; annualValue: number; ytdRevenue: number }
  weeklyByTech: ByTech
  monthlyByTech: ByTech
  techs: TechPerf[]
}

// Department colors (shared convention with the other Scoreboards).
const DEPT_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  WF: { bg: 'rgba(34,197,94,0.75)', border: '#22c55e', label: 'Lawn Care (WF)' },
  IR: { bg: 'rgba(14,165,233,0.75)', border: '#0ea5e9', label: 'Irrigation (IR)' },
  PW: { bg: 'rgba(245,158,11,0.75)', border: '#f59e0b', label: 'Pet Waste (PW)' },
  MO: { bg: 'rgba(139,92,246,0.75)', border: '#8b5cf6', label: 'Mosquito (MO)' },
  Other: { bg: 'rgba(100,116,139,0.75)', border: '#64748b', label: 'Other' },
}
// Per-technician stack colors: amber first to match the PW brand color.
const TECH_COLORS = [
  { bg: 'rgba(245,158,11,0.80)', border: '#f59e0b' },
  { bg: 'rgba(34,197,94,0.80)', border: '#22c55e' },
  { bg: 'rgba(139,92,246,0.80)', border: '#8b5cf6' },
  { bg: 'rgba(14,165,233,0.80)', border: '#0ea5e9' },
  { bg: 'rgba(236,72,153,0.80)', border: '#ec4899' },
]
const OTHER_COLOR = { bg: 'rgba(100,116,139,0.55)', border: '#64748b' }
const GRID = 'rgba(255,255,255,0.06)'
const usd = (v: number) => formatCurrency(v)
const usdTick = (v: number | string) => { const n = Number(v); return '$' + (n >= 1000 ? Math.round(n / 1000) + 'k' : n) }

const tooltipStyle = {
  backgroundColor: 'rgba(15,46,71,0.96)', borderColor: 'rgba(56,189,248,0.3)', borderWidth: 1,
  titleColor: '#bae6fd', bodyColor: '#94a3b8', padding: 10,
}
const stackedScales = {
  x: { stacked: true, grid: { color: GRID }, ticks: { color: '#64748b' } },
  y: { stacked: true, grid: { color: GRID }, ticks: { color: '#64748b', callback: usdTick } },
}

// ── Layout primitives (match the other Scoreboards) ──
function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-amber-400/12 bg-gradient-to-br from-[var(--t-panel)] to-[var(--t-sidebar)] p-5 ${className}`}>
      <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-amber-500 via-amber-400 to-transparent" />
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
function TechLegends({ by }: { by: ByTech }) {
  const items = by.techs.map((tk, i) => ({ label: tk.name, color: TECH_COLORS[i % TECH_COLORS.length].border }))
  if (by.other) items.push({ label: 'Other / Unassigned', color: OTHER_COLOR.border })
  return (
    <div className="mt-2.5 flex flex-wrap gap-2.5">
      {items.map(it => (
        <span key={it.label} className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} />{it.label}
        </span>
      ))}
    </div>
  )
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
function Kpi({ label, value, sub, badge }: { label: string; value: string; sub?: string; badge?: string }) {
  return (
    <Card>
      <div className="text-[11px] font-medium text-amber-300">{label}</div>
      <div className="mt-1.5 text-[26px] font-bold leading-none tracking-tight text-sky-50">{value}</div>
      {sub && <div className="mt-1.5 text-[11px] text-gray-500">{sub}</div>}
      {badge && <span className="mt-1.5 inline-block rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-400">{badge}</span>}
    </Card>
  )
}

function techDatasets(by: ByTech) {
  const ds = by.techs.map((tk, i) => ({
    label: tk.name,
    data: tk.data,
    backgroundColor: TECH_COLORS[i % TECH_COLORS.length].bg,
    borderColor: TECH_COLORS[i % TECH_COLORS.length].border,
    borderWidth: 1, borderRadius: 2,
  }))
  if (by.other) ds.push({ label: 'Other / Unassigned', data: by.other, backgroundColor: OTHER_COLOR.bg, borderColor: OTHER_COLOR.border, borderWidth: 1, borderRadius: 2 })
  return ds
}

function deptDatasets(series: DeptData, depts: string[]) {
  return depts.map(d => ({
    label: DEPT_COLORS[d]?.label ?? d,
    data: series[d] ?? [],
    backgroundColor: DEPT_COLORS[d]?.bg,
    borderColor: DEPT_COLORS[d]?.border,
    borderWidth: 1, borderRadius: 2,
  }))
}

function Dashboard({ data, meta }: { data: Payload; meta: ScoreboardMeta }) {
  const noTechs = data.weeklyByTech.techs.length === 0

  return (
    <div className="mx-auto max-w-[1280px] px-4 md:px-6 pb-12 pt-2">
      {/* KPI summary */}
      <SectionTitle>PW at a Glance · Active Book</SectionTitle>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Kpi label="Active PW Customers" value={String(data.kpis.activeCustomers)} sub="Active pet waste accounts" />
        <Kpi label="Total Annual Value" value={usd(data.kpis.annualValue)} sub="Annual value of active PW book" />
      </div>

      {/* PW visit revenue, stacked by technician */}
      <SectionTitle>PW Visit Revenue · by Technician</SectionTitle>
      <div className="mb-4">
        <Kpi label="PW Revenue · Year to Date" value={usd(data.kpis.ytdRevenue)} sub="Completed PW visits since Jan 1 · actual revenue (not book value)" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <ChartHead title="Weekly Revenue" sub="Trailing 6 weeks · completed PW visits" />
          {noTechs
            ? <div className="flex h-[220px] items-center justify-center text-sm text-gray-500">No technicians assigned</div>
            : <><ChartCanvas make={c => new Chart(c, {
                type: 'bar',
                data: { labels: data.weeklyByTech.labels, datasets: techDatasets(data.weeklyByTech) },
                options: {
                  responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${usd(ctx.parsed.y ?? 0)}` } } },
                  scales: stackedScales,
                },
              })} />
              <TechLegends by={data.weeklyByTech} /></>}
        </Card>
        <Card>
          <ChartHead title="Monthly Revenue" sub="Trailing 4 months · completed PW visits" />
          {noTechs
            ? <div className="flex h-[220px] items-center justify-center text-sm text-gray-500">No technicians assigned</div>
            : <><ChartCanvas make={c => new Chart(c, {
                type: 'bar',
                data: { labels: data.monthlyByTech.labels, datasets: techDatasets(data.monthlyByTech) },
                options: {
                  responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${usd(ctx.parsed.y ?? 0)}` } } },
                  scales: stackedScales,
                },
              })} />
              <TechLegends by={data.monthlyByTech} /></>}
        </Card>
      </div>

      {/* Technicians — full performance (all departments) */}
      <SectionTitle>Technicians</SectionTitle>
      {data.techs.length === 0
        ? <Card><div className="py-8 text-center text-sm text-gray-500">No PW technicians assigned. Add them in Admin → Scoreboards.</div></Card>
        : data.techs.map(tech => (
            <div key={tech.name} className="mb-5">
              <div className="mb-3 flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-amber-400 text-[11px] font-bold text-amber-950">
                  {tech.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
                </div>
                <span className="text-[15px] font-semibold text-sky-100">{tech.name}</span>
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                {/* Weekly revenue stacked by dept (all departments) */}
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
                {/* Monthly revenue stacked by dept (all departments) */}
                <Card>
                  <ChartHead title="Monthly Revenue" sub="Trailing 4 months · all departments" />
                  {tech.monthDepts.length === 0
                    ? <div className="flex h-[220px] items-center justify-center text-sm text-gray-500">No completed visits</div>
                    : <><ChartCanvas make={c => new Chart(c, {
                          type: 'bar',
                          data: { labels: tech.monthly.labels, datasets: deptDatasets(tech.monthly.data, tech.monthDepts) },
                          options: {
                            responsive: true, maintainAspectRatio: false,
                            plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${usd(ctx.parsed.y ?? 0)}` } } },
                            scales: stackedScales,
                          },
                        })} />
                        <DeptLegends depts={tech.monthDepts} /></>}
                </Card>
                {/* $/hour last complete week */}
                <Card>
                  <ChartHead title="Revenue per Hour" sub={`Last week · ${tech.perHour.weekLabel}`} />
                  <div className="flex h-[220px] flex-col items-center justify-center">
                    <div>
                      <span className="text-[52px] font-extrabold leading-none tracking-tight text-amber-400">{usd(tech.perHour.rate)}</span>
                      <span className="text-xl font-bold text-amber-400">/hr</span>
                    </div>
                    <div className="mt-3 text-center text-xs text-gray-500">{usd(tech.perHour.revenue)} revenue ÷ {tech.perHour.hours} hrs</div>
                    {tech.perHour.hours === 0 && <div className="mt-2 text-center text-[11px] text-gray-600">No hours logged last week</div>}
                  </div>
                </Card>
              </div>
            </div>
          ))}

      <div className="mt-5 text-right text-[11px] text-gray-600">
        {meta.title} · Synced from Jobber + Recurring Services + Timesheets · updated {new Date(data.asOf).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </div>
    </div>
  )
}

export default function Scoreboard4View({ meta, businessName = 'Heroes Lawn Care' }: { meta: ScoreboardMeta; businessName?: string }) {
  const [snapshotId, setSnapshotId] = useState<string | null>(null)
  const { data, error, reload } = useScoreboardData<Payload>(meta.slug, snapshotId)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--t-well)] text-gray-200">
      <header className="flex items-center gap-3.5 border-b border-amber-400/15 bg-gradient-to-br from-[var(--t-panel)] to-[var(--t-sidebar)] px-5 py-4 max-md:pl-14">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-amber-400 text-lg">🐾</div>
        <div>
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-sky-50">{meta.title}</h1>
            {meta.badge && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-semibold text-amber-400">{meta.badge}</span>}
          </div>
          <div className="text-[13px] text-amber-300">{businessName} · Pet Waste KPIs</div>
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
