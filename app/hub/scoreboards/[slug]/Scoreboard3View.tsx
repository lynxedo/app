'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import {
  Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend,
} from 'chart.js'
import type { ScoreboardMeta } from '@/lib/scoreboards/registry'
import { useScoreboardData } from '@/hooks/use-scoreboard-data'
import ScoreboardError from '@/components/hub/ScoreboardError'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend)
Chart.defaults.color = '#64748b'
Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
Chart.defaults.font.size = 11

// ── Types (mirror the API payload for board 3) ──
type ByTech = { labels: string[]; techs: { name: string; data: number[] }[]; other: number[] | null }
type Tech = { name: string; perHour: { revenue: number; hours: number; rate: number; weekLabel: string } }
type Payload = {
  asOf: string
  kpis: { activeGold: number; goldAnnualValue: number; repairAvg: number; repairMedian: number; repairCount: number }
  weeklyByTech: ByTech
  monthlyByTech: ByTech
  rachioSold: { labels: string[]; data: number[] }
  goldSold: { labels: string[]; data: number[] }
  techs: Tech[]
}

// Per-technician stack colors (assigned by order). "Other/Unassigned" is muted.
const TECH_COLORS = [
  { bg: 'rgba(14,165,233,0.80)', border: '#0ea5e9' },  // sky
  { bg: 'rgba(34,197,94,0.80)', border: '#22c55e' },   // emerald
  { bg: 'rgba(139,92,246,0.80)', border: '#8b5cf6' },  // violet
  { bg: 'rgba(245,158,11,0.80)', border: '#f59e0b' },  // amber
  { bg: 'rgba(236,72,153,0.80)', border: '#ec4899' },  // pink
]
const OTHER_COLOR = { bg: 'rgba(100,116,139,0.55)', border: '#64748b' }
const GRID = 'rgba(255,255,255,0.06)'
const usd = (v: number) => '$' + Math.round(v).toLocaleString()
const usdTick = (v: number | string) => { const n = Number(v); return '$' + (n >= 1000 ? Math.round(n / 1000) + 'k' : n) }

const tooltipStyle = {
  backgroundColor: 'rgba(15,46,71,0.96)', borderColor: 'rgba(56,189,248,0.3)', borderWidth: 1,
  titleColor: '#bae6fd', bodyColor: '#94a3b8', padding: 10,
}
const stackedScales = {
  x: { stacked: true, grid: { color: GRID }, ticks: { color: '#64748b' } },
  y: { stacked: true, grid: { color: GRID }, ticks: { color: '#64748b', callback: usdTick } },
}
const countScales = {
  x: { grid: { color: GRID }, ticks: { color: '#64748b' } },
  y: { grid: { color: GRID }, ticks: { color: '#64748b', precision: 0, stepSize: 1 }, beginAtZero: true },
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

// ── Layout primitives (match the other Scoreboards) ──
function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-sky-400/12 bg-gradient-to-br from-[#0f2e47] to-[#1a3d5c] p-5 ${className}`}>
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
function TechLegends({ by }: { by: ByTech }) {
  const items = by.techs.map((tk, i) => ({ label: tk.name, color: TECH_COLORS[i % TECH_COLORS.length].border }))
  if (by.other) items.push({ label: 'Other / Unassigned', color: OTHER_COLOR.border })
  return (
    <div className="mt-2.5 flex flex-wrap gap-2.5">
      {items.map(it => (
        <span key={it.label} className="flex items-center gap-1.5 text-[11px] text-slate-400"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} />{it.label}</span>
      ))}
    </div>
  )
}
function Kpi({ label, value, sub, badge }: { label: string; value: string; sub?: string; badge?: string }) {
  return (
    <Card>
      <div className="text-[11px] font-medium text-sky-300">{label}</div>
      <div className="mt-1.5 text-[26px] font-bold leading-none tracking-tight text-sky-50">{value}</div>
      {sub && <div className="mt-1.5 text-[11px] text-slate-500">{sub}</div>}
      {badge && <span className="mt-1.5 inline-block rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-400">{badge}</span>}
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

function Dashboard({ data, meta }: { data: Payload; meta: ScoreboardMeta }) {
  const { kpis } = data
  const noTechs = data.weeklyByTech.techs.length === 0

  return (
    <div className="mx-auto max-w-[1280px] px-4 md:px-6 pb-12 pt-2">
      {/* KPI summary */}
      <SectionTitle>IR at a Glance</SectionTitle>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <Kpi label="Active IR Gold Customers" value={String(kpis.activeGold)} sub="Gold service plan · active book" />
        <Kpi label="Gold Annual Value" value={usd(kpis.goldAnnualValue)} sub="Annual value of active Gold book" />
        <Kpi label="Avg Repair Ticket" value={usd(kpis.repairAvg)} sub={`Median ${usd(kpis.repairMedian)} · trailing 12 mo`} badge={`${kpis.repairCount} tickets`} />
      </div>

      {/* IR visit revenue, stacked by technician */}
      <SectionTitle>IR Visit Revenue · by Technician</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <ChartHead title="Weekly Revenue" sub="Trailing 6 weeks · completed IR visits" />
          {noTechs
            ? <div className="flex h-[220px] items-center justify-center text-sm text-slate-500">No technicians assigned</div>
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
          <ChartHead title="Monthly Revenue" sub="Trailing 4 months · completed IR visits" />
          {noTechs
            ? <div className="flex h-[220px] items-center justify-center text-sm text-slate-500">No technicians assigned</div>
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

      {/* Sold per week */}
      <SectionTitle>Sold · Trailing 6 Weeks</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <ChartHead title="Rachio Controllers Sold" sub="Per week · Lead Tracker" />
          <ChartCanvas make={c => new Chart(c, {
            type: 'bar',
            data: { labels: data.rachioSold.labels, datasets: [{ label: 'Rachios', data: data.rachioSold.data, backgroundColor: 'rgba(14,165,233,0.78)', borderColor: '#0ea5e9', borderWidth: 1, borderRadius: 4 }] },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${ctx.parsed.y ?? 0} sold` } } },
              scales: countScales,
            },
          })} />
        </Card>
        <Card>
          <ChartHead title="Irrigation Gold Plans Sold" sub="Per week · Lead Tracker" />
          <ChartCanvas make={c => new Chart(c, {
            type: 'bar',
            data: { labels: data.goldSold.labels, datasets: [{ label: 'Gold Plans', data: data.goldSold.data, backgroundColor: 'rgba(245,158,11,0.78)', borderColor: '#f59e0b', borderWidth: 1, borderRadius: 4 }] },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${ctx.parsed.y ?? 0} sold` } } },
              scales: countScales,
            },
          })} />
        </Card>
      </div>

      {/* Technicians — $/hour */}
      <SectionTitle>Technician Revenue per Hour</SectionTitle>
      {data.techs.length === 0
        ? <Card><div className="py-8 text-center text-sm text-slate-500">No IR technicians assigned. Add them in Admin → Scoreboards.</div></Card>
        : <div className="grid gap-4 sm:grid-cols-2">
            {data.techs.map(tech => (
              <Card key={tech.name}>
                <div className="mb-3 flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-sky-400 text-[11px] font-bold text-sky-950">{tech.name.split(' ').map(p => p[0]).slice(0, 2).join('')}</div>
                  <span className="text-[15px] font-semibold text-sky-100">{tech.name}</span>
                </div>
                <ChartHead title="Revenue per Hour" sub={`Last week · ${tech.perHour.weekLabel}`} />
                <div className="flex h-[180px] flex-col items-center justify-center">
                  <div><span className="text-[52px] font-extrabold leading-none tracking-tight text-sky-400">{usd(tech.perHour.rate)}</span><span className="text-xl font-bold text-sky-400">/hr</span></div>
                  <div className="mt-3 text-center text-xs text-slate-500">{usd(tech.perHour.revenue)} revenue ÷ {tech.perHour.hours} hrs</div>
                  {tech.perHour.hours === 0 && <div className="mt-2 text-center text-[11px] text-slate-600">No hours logged last week</div>}
                </div>
              </Card>
            ))}
          </div>}

      <div className="mt-5 text-right text-[11px] text-slate-600">
        {meta.title} · Synced from Jobber + Recurring Services + Lead Tracker + Timesheets · updated {new Date(data.asOf).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </div>
    </div>
  )
}

export default function Scoreboard3View({ meta }: { meta: ScoreboardMeta }) {
  const { data, error, reload } = useScoreboardData<Payload>(meta.slug)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#0b1929] text-slate-200">
      <header className="flex items-center gap-3.5 border-b border-sky-400/15 bg-gradient-to-br from-[#0f2e47] to-[#1a3d5c] px-5 py-4 max-md:pl-14">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-sky-400 text-lg">💧</div>
        <div>
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-sky-50">{meta.title}</h1>
            {meta.badge && <span className="rounded-full bg-sky-400/15 px-2 py-0.5 text-[11px] font-semibold text-sky-400">{meta.badge}</span>}
          </div>
          <div className="text-[13px] text-sky-300">Heroes Lawn Care · Irrigation KPIs</div>
        </div>
      </header>

      {error
        ? <ScoreboardError error={error} onRetry={reload} />
        : !data
          ? <div className="px-6 py-16 text-center text-sm text-slate-500">Loading scoreboard…</div>
          : <Dashboard data={data} meta={meta} />}
    </div>
  )
}
