'use client'

import { useState, useEffect, useCallback } from 'react'
import type { ScoreboardMeta } from '@/lib/scoreboards/registry'

type Cats = Record<string, string>
type Rec = {
  id: string
  source: 'dialer' | 'unitel'
  ts: string | null
  grade: string | null
  rep: string | null
  mustListen: boolean
  acknowledged: boolean
  phone: string | null
  headline: string | null
  cats: Cats | null
}

const GPA: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 }
const LETTERS = ['A', 'B', 'C', 'D', 'F']

const CAT_LABELS: Record<string, string> = {
  greeting: 'Greeting', customer_name_use: 'Customer name use', active_listening: 'Active listening',
  tone_match: 'Tone match', accuracy: 'Accuracy', clear_next_step: 'Clear next step',
  professionalism: 'Professionalism', discovery: 'Discovery', bundling: 'Cross-sell',
  differentiator: 'Differentiator', program_explanation: 'Program explanation',
  objection_handling: 'Objection handling', asked_for_the_sale: 'Asked for sale',
  booked_next_step: 'Booked next step', acknowledged_before_defending: 'Acknowledged first',
  ownership: 'Took ownership', concrete_resolution: 'Concrete resolution',
  loop_closed: 'Loop closed', save_attempted: 'Save attempted',
}

function gpaToLetter(g: number): string {
  if (g >= 3.5) return 'A'
  if (g >= 2.5) return 'B'
  if (g >= 1.5) return 'C'
  if (g >= 0.5) return 'D'
  return 'F'
}
function gradeBar(letter: string): string {
  return { A: '#639922', B: '#1D9E75', C: '#EF9F27', D: '#D85A30', F: '#E24B4A' }[letter] || '#6b7280'
}
function gradeChip(letter: string): string {
  return {
    A: 'text-green-300 bg-green-900/40 border-green-700/50',
    B: 'text-teal-300 bg-teal-900/40 border-teal-700/50',
    C: 'text-amber-300 bg-amber-900/40 border-amber-700/50',
    D: 'text-orange-300 bg-orange-900/40 border-orange-700/50',
    F: 'text-red-300 bg-red-900/40 border-red-700/50',
  }[letter] || 'text-gray-300 bg-gray-800 border-gray-700'
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function rangeFor(preset: string, cf: string, ct: string): { from: string; to: string } | null {
  const today = ymd(new Date())
  if (preset === 'custom') return cf && ct ? { from: cf, to: ct } : null
  if (preset === 'all') return { from: '2000-01-01', to: today }
  if (preset === 'ytd') return { from: `${new Date().getFullYear()}-01-01`, to: today }
  const d = new Date()
  d.setDate(d.getDate() - (preset === 'week' ? 6 : 29))
  return { from: ymd(d), to: today }
}
function weekKey(ts: string): string {
  const d = new Date(ts)
  const monday = new Date(d)
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return ymd(monday)
}

const PRESETS = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'ytd', label: 'YTD' },
  { id: 'all', label: 'All' },
]

export default function Scoreboard6View({ meta }: { meta: ScoreboardMeta }) {
  const [preset, setPreset] = useState('ytd')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [rep, setRep] = useState('all')
  const [calls, setCalls] = useState<Rec[]>([])
  const [reps, setReps] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true)
    setErr('')
    try {
      const res = await fetch(`/api/hub/scoreboards/coaching?from=${from}&to=${to}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setCalls(data.calls ?? [])
      setReps(data.reps ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const r = rangeFor(preset, customFrom, customTo)
    if (r) load(r.from, r.to)
  }, [preset, customFrom, customTo, load])

  // ── Client-side rep filter + aggregation ──
  const filtered = rep === 'all' ? calls : calls.filter(c => c.rep === rep)
  const graded = filtered.filter(c => c.grade && GPA[c.grade] !== undefined)
  const gradedCount = graded.length
  const avgGpa = gradedCount ? graded.reduce((s, c) => s + GPA[c.grade as string], 0) / gradedCount : 0
  const abCount = graded.filter(c => c.grade === 'A' || c.grade === 'B').length
  const mustOpen = filtered.filter(c => c.mustListen && !c.acknowledged)

  const dist = LETTERS.map(l => ({ l, n: graded.filter(c => c.grade === l).length }))
  const distMax = Math.max(1, ...dist.map(d => d.n))

  // Trend: avg GPA per week, last 14 weeks present in the data.
  const weekMap = new Map<string, { sum: number; n: number }>()
  for (const c of graded) {
    if (!c.ts) continue
    const k = weekKey(c.ts)
    const w = weekMap.get(k) || { sum: 0, n: 0 }
    w.sum += GPA[c.grade as string]
    w.n += 1
    weekMap.set(k, w)
  }
  const trend = Array.from(weekMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14)
    .map(([k, w]) => ({ k, gpa: w.sum / w.n }))

  // Category weak spots: % needs-work per category, across graded calls.
  const catAgg = new Map<string, { nw: number; scored: number }>()
  for (const c of graded) {
    if (!c.cats) continue
    for (const [key, score] of Object.entries(c.cats)) {
      const s = score.toLowerCase()
      if (!['strong', 'adequate', 'needs work'].includes(s)) continue
      const a = catAgg.get(key) || { nw: 0, scored: 0 }
      a.scored += 1
      if (s === 'needs work') a.nw += 1
      catAgg.set(key, a)
    }
  }
  const cats = Array.from(catAgg.entries())
    .filter(([, a]) => a.scored >= 3)
    .map(([key, a]) => ({ key, label: CAT_LABELS[key] || key, pct: Math.round((a.nw / a.scored) * 100), scored: a.scored }))
    .sort((x, y) => y.pct - x.pct)
    .slice(0, 8)

  // Per rep
  const repMap = new Map<string, { sum: number; n: number; must: number }>()
  for (const c of filtered) {
    const name = c.rep || '(unassigned)'
    const r = repMap.get(name) || { sum: 0, n: 0, must: 0 }
    if (c.grade && GPA[c.grade] !== undefined) { r.sum += GPA[c.grade]; r.n += 1 }
    if (c.mustListen && !c.acknowledged) r.must += 1
    repMap.set(name, r)
  }
  const perRep = Array.from(repMap.entries())
    .map(([name, r]) => ({ name, graded: r.n, avg: r.n ? gpaToLetter(r.sum / r.n) : '—', must: r.must }))
    .sort((a, b) => b.graded - a.graded)

  const mustList = mustOpen
    .slice()
    .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
    .slice(0, 25)

  const fmtPhone = (p: string | null) => {
    if (!p) return '—'
    const d = p.replace(/\D/g, '')
    if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
    if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
    return p
  }

  const inputCls =
    'bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500'

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <header className="px-4 md:px-6 pt-4 pb-2 max-md:pl-14">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">{meta.title}</h1>
        <p className="text-sm text-gray-400 mt-1">{meta.subtitle}</p>
      </header>

      {/* Filters */}
      <div className="px-4 md:px-6 py-3 border-y border-gray-800 bg-gray-900/50 flex flex-wrap items-end gap-2">
        <div className="flex gap-1.5">
          {PRESETS.map(p => (
            <button key={p.id} onClick={() => setPreset(p.id)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${preset === p.id ? 'bg-purple-700 border-purple-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-1.5">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">From</label>
            <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPreset('custom') }} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">To</label>
            <input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setPreset('custom') }} className={inputCls} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Rep</label>
          <select value={rep} onChange={e => setRep(e.target.value)} className={inputCls}>
            <option value="all">All reps</option>
            {reps.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="ml-auto text-xs text-gray-500 self-center">{loading ? 'Loading…' : `${gradedCount} graded`}</div>
      </div>

      <main className="px-4 md:px-6 py-5 space-y-5 max-w-5xl">
        {err && <div className="text-sm text-red-400">{err}</div>}

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="text-xs text-gray-500">Avg grade</div>
            <div className="text-2xl font-bold mt-1">{gradedCount ? gpaToLetter(avgGpa) : '—'}</div>
            <div className="text-xs text-gray-600 mt-0.5">{gradedCount ? `${avgGpa.toFixed(1)} / 4.0` : 'no graded calls'}</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="text-xs text-gray-500">Graded calls</div>
            <div className="text-2xl font-bold mt-1">{gradedCount}</div>
            <div className="text-xs text-gray-600 mt-0.5">excludes N/A</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="text-xs text-gray-500">A–B rate</div>
            <div className="text-2xl font-bold mt-1">{gradedCount ? `${Math.round((abCount / gradedCount) * 100)}%` : '—'}</div>
            <div className="text-xs text-gray-600 mt-0.5">{abCount} calls</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="text-xs text-gray-500">★ Must-listen</div>
            <div className="text-2xl font-bold mt-1 text-red-300">{mustOpen.length}</div>
            <div className="text-xs text-gray-600 mt-0.5">open for review</div>
          </div>
        </div>

        {/* Grade distribution + Trend */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Grade distribution</div>
            {dist.map(d => (
              <div key={d.l} className="flex items-center gap-2 py-1">
                <span className="w-4 text-sm">{d.l}</span>
                <div className="flex-1 bg-gray-800 rounded h-4 overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${(d.n / distMax) * 100}%`, background: gradeBar(d.l) }} />
                </div>
                <span className="w-9 text-right text-xs text-gray-400">{d.n}</span>
              </div>
            ))}
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Avg grade by week</div>
            {trend.length === 0 ? (
              <div className="text-sm text-gray-600">Not enough data.</div>
            ) : (
              <div className="flex items-end gap-1.5 h-32">
                {trend.map(t => (
                  <div key={t.k} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${t.k}: ${t.gpa.toFixed(1)}`}>
                    <div className="w-full rounded-t" style={{ height: `${(t.gpa / 4) * 100}%`, background: gradeBar(gpaToLetter(t.gpa)) }} />
                    <span className="text-[10px] text-gray-600 whitespace-nowrap">{t.k.slice(5)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Weakest categories + Must-listen queue */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Weakest categories <span className="text-gray-600 normal-case">(% needs work)</span></div>
            {cats.length === 0 ? (
              <div className="text-sm text-gray-600">No scored categories yet.</div>
            ) : cats.map(c => (
              <div key={c.key} className="flex items-center gap-2 py-1">
                <span className="w-32 text-sm text-gray-300 truncate" title={c.label}>{c.label}</span>
                <div className="flex-1 bg-gray-800 rounded h-4 overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${c.pct}%`, background: c.pct >= 60 ? '#D85A30' : '#EF9F27' }} />
                </div>
                <span className="w-9 text-right text-xs text-gray-400">{c.pct}%</span>
              </div>
            ))}
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">★ Must-listen queue <span className="text-gray-600 normal-case">({mustOpen.length})</span></div>
            {mustList.length === 0 ? (
              <div className="text-sm text-gray-600">Nothing flagged. 🎉</div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {mustList.map(c => (
                  <a key={c.id} href={c.source === 'dialer' ? '/hub/call-log2' : '/hub/call-log'}
                    className="block border-b border-gray-800 pb-2 hover:bg-gray-800/40 rounded px-1 -mx-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-white">{fmtPhone(c.phone)}</span>
                      {c.grade && <span className={`px-1.5 py-0.5 rounded text-xs font-bold border ${gradeChip(c.grade)}`}>{c.grade}</span>}
                    </div>
                    {c.headline && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{c.headline}</p>}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Per rep */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">By rep</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-left border-b border-gray-800">
                <th className="font-normal py-1">Rep</th><th className="font-normal">Graded</th><th className="font-normal">Avg</th><th className="font-normal">★ Must-listen</th>
              </tr>
            </thead>
            <tbody>
              {perRep.map(r => (
                <tr key={r.name} className="border-b border-gray-800 last:border-0">
                  <td className="py-2 text-white">{r.name}</td>
                  <td className="text-gray-300">{r.graded}</td>
                  <td><span className={`px-1.5 py-0.5 rounded text-xs font-bold border ${gradeChip(r.avg)}`}>{r.avg}</span></td>
                  <td className="text-gray-300">{r.must}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
