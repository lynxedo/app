'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast, useConfirm } from '@/components/ui'
import { periodLabel, periodBounds, type GoalGrain } from '@/lib/reports/goals'

type Metric = { key: string; label: string; format: 'currency' | 'number' | 'percent'; help: string }
type Goal = {
  id: string
  metric: string
  grain: GoalGrain
  period_start: string
  period_end: string
  target: number
}

function fmtTarget(format: Metric['format'], v: number): string {
  if (format === 'currency') return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  if (format === 'percent') return `${v}%`
  return v.toLocaleString()
}

/** This month, as the period a new goal defaults to. */
function thisMonthISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

export default function GoalsAdminPanel({ metrics, goals }: { metrics: Metric[]; goals: Goal[] }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()

  const [metric, setMetric] = useState(metrics[0]?.key ?? '')
  const [grain, setGrain] = useState<GoalGrain>('month')
  const [periodStart, setPeriodStart] = useState(thisMonthISO())
  const [target, setTarget] = useState('')
  const [saving, setSaving] = useState(false)

  const selected = metrics.find(m => m.key === metric) ?? null
  // Shown before saving, because "which period is this?" is the thing an admin
  // gets wrong — a quarter set from a mid-quarter date is still that quarter.
  const bounds = /^\d{4}-\d{2}-\d{2}$/.test(periodStart) ? periodBounds(grain, periodStart) : null

  async function save() {
    const value = Number(target)
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Enter a target above zero')
      return
    }
    setSaving(true)
    const res = await fetch('/api/admin/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metric, grain, period_start: periodStart, target: value }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error || 'Could not save that target')
      return
    }
    setTarget('')
    toast.success('Target saved')
    router.refresh()
  }

  async function remove(g: Goal) {
    const label = metrics.find(m => m.key === g.metric)?.label ?? g.metric
    const ok = await confirm({
      title: 'Remove this target?',
      message: `${label} for ${periodLabel(g.grain, g.period_start)} will no longer appear on the Goals report. Nothing else changes.`,
      confirmText: 'Remove',
      danger: true,
    })
    if (!ok) return
    const res = await fetch(`/api/admin/goals?id=${encodeURIComponent(g.id)}`, { method: 'DELETE' })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error || 'Could not remove that target')
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Goals &amp; targets</h1>
        <p className="text-gray-500 text-sm mt-1">
          What the business is aiming at. Each target is measured against its own period on the
          <strong className="text-gray-300"> Goals &amp; Targets</strong> report, using the same numbers the other
          reports show &mdash; so a goal can never disagree with the report it is judged against. Setting a target for
          a period that already has one replaces it.
        </p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 md:p-6">
        <div className="grid gap-4 md:grid-cols-4">
          <label className="block">
            <span className="text-xs text-gray-400">Measure</span>
            <select
              value={metric}
              onChange={e => setMetric(e.target.value)}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            >
              {metrics.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-gray-400">Period</span>
            <select
              value={grain}
              onChange={e => setGrain(e.target.value as GoalGrain)}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            >
              <option value="month">Monthly</option>
              <option value="quarter">Quarterly</option>
              <option value="year">Yearly</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-gray-400">Any date in that period</span>
            <input
              type="date"
              value={periodStart}
              onChange={e => setPeriodStart(e.target.value)}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-xs text-gray-400">
              Target{selected?.format === 'currency' ? ' ($)' : selected?.format === 'percent' ? ' (%)' : ''}
            </span>
            <input
              type="number"
              min="0"
              step="any"
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder="0"
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            />
          </label>
        </div>

        {selected && <p className="text-gray-500 text-xs mt-3">{selected.help}</p>}
        {bounds && (
          <p className="text-sky-300/80 text-xs mt-1">
            This target will cover <strong>{periodLabel(grain, bounds.start)}</strong> &mdash; {bounds.start} to {bounds.end}.
          </p>
        )}

        <button
          onClick={save}
          disabled={saving}
          className="mt-4 rounded-lg px-4 py-2 text-sm font-medium bg-brand hover:bg-brand-hover text-[#fff] disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save target'}
        </button>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Targets set</h2>
        {goals.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-8 text-center text-sm text-gray-500">
            No targets yet. The Goals report will say so rather than showing an empty chart.
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl divide-y divide-gray-800">
            {goals.map(g => {
              const m = metrics.find(x => x.key === g.metric)
              return (
                <div key={g.id} className="px-4 md:px-6 py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {m?.label ?? g.metric}
                      <span className="text-gray-500 font-normal"> · {periodLabel(g.grain, g.period_start)}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {m ? fmtTarget(m.format, g.target) : g.target}
                      {!m && ' · this measure is no longer available and will show as unknown on the report'}
                    </div>
                  </div>
                  <button
                    onClick={() => remove(g)}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium border bg-gray-800 border-gray-700 text-gray-400 hover:text-red-300 hover:border-red-800"
                  >
                    Remove
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
