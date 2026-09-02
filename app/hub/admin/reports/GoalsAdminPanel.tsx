'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast, useConfirm } from '@/components/ui'
import { periodLabel, periodBounds, GOAL_METRIC_GROUPS, type GoalGrain, type GoalMetricGroup } from '@/lib/reports/goals'

type Metric = {
  key: string
  label: string
  /** Which section of the picker it sits in. 23 measures is too many for a flat list. */
  group: GoalMetricGroup
  format: 'currency' | 'number' | 'percent' | 'duration'
  /** ⚠ 'lower' means the target is a CEILING — the form has to say so before saving. */
  direction: 'higher' | 'lower'
  /** Period lengths this measure can be set for. */
  grains: GoalGrain[]
  help: string
  /** Can this measure be set for one person? See lib/reports/goals.ts. */
  perPerson: boolean
  /** Why not, shown to the admin instead of the option just being absent. */
  perPersonBlocker: string | null
  /** Shown ONLY once a person is picked: this measure is allowed per person but
   *  is not meaningful for every person. See lib/reports/goals.ts. */
  perPersonCaution: string | null
}
type Employee = { id: string; name: string; department: string | null; is_active: boolean }
type Goal = {
  id: string
  metric: string
  grain: GoalGrain
  period_start: string
  period_end: string
  target: number
  /** Null on a company-wide target. */
  employee_id: string | null
  person_name: string | null
  /** True = the standing target for every period of this grain from period_start on. */
  repeats: boolean
}

/** The company-wide option's value. Not '' so an unset select cannot look like it. */
const COMPANY = 'company'

function fmtTarget(m: Metric, v: number): string {
  const n = m.format === 'currency'
    ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : m.format === 'percent'
      ? `${v}%`
      : m.format === 'duration'
        ? v >= 60 ? `${Math.floor(v / 60)}m ${v % 60}s` : `${v}s`
        : v.toLocaleString()
  // ⚠ A ceiling reads "at most". Without it a 22% labour target looks like
  // something to reach for, which is the opposite of what it means.
  return m.direction === 'lower' ? `at most ${n}` : n
}

/** What the Target box is counted in. */
function targetUnit(m: Metric | null): string {
  if (!m) return ''
  if (m.format === 'currency') return ' ($)'
  if (m.format === 'percent') return ' (%)'
  if (m.format === 'duration') return ' (seconds)'
  return ''
}

const GRAIN_LABEL: Record<GoalGrain, string> = {
  month: 'Monthly', quarter: 'Quarterly', year: 'Yearly',
}

/** "month" / "quarter" / "year", for sentences about repetition. */
const GRAIN_NOUN: Record<GoalGrain, string> = {
  month: 'month', quarter: 'quarter', year: 'year',
}

/** This month, as the period a new goal defaults to. */
function thisMonthISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

export default function GoalsAdminPanel(
  { metrics, goals, employees }: { metrics: Metric[]; goals: Goal[]; employees: Employee[] },
) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()

  const [metric, setMetric] = useState(metrics[0]?.key ?? '')
  const [grain, setGrain] = useState<GoalGrain>('month')
  const [periodStart, setPeriodStart] = useState(thisMonthISO())
  const [target, setTarget] = useState('')
  const [who, setWho] = useState<string>(COMPANY)
  /* ⚠ Defaults ON, which is the whole point of the change. Ben: "It seems like we
   * would need to set a goal for each month if we choose month? That could come in
   * handy but also very repetitive." So the common case — one number that stands until
   * you change it — is the default, and a target for one specific period is the
   * deliberate exception. */
  const [repeats, setRepeats] = useState(true)
  const [saving, setSaving] = useState(false)
  /** The target being edited, or null when the form is setting a new one. */
  const [editing, setEditing] = useState<Goal | null>(null)

  const selected = metrics.find(m => m.key === metric) ?? null

  // Someone deactivated can still hold a target for a period they worked, so they
  // stay listed — just clearly marked, rather than vanishing and taking the
  // explanation for an existing row with them.
  const roster = [...employees].sort((a, b) =>
    a.is_active === b.is_active ? a.name.localeCompare(b.name) : a.is_active ? -1 : 1)

  // ⚠ Switching to a measure that cannot be per-person snaps the picker back to
  // the company rather than leaving a person selected that the API would refuse —
  // a form that lets you build an invalid request and only complains on Save is
  // the thing this avoids.
  const personAllowed = selected?.perPerson === true
  const effectiveWho = personAllowed ? who : COMPANY
  const employeeId = effectiveWho === COMPANY ? null : effectiveWho
  // ⚠ Same reasoning as the person picker above: a measure that only accepts
  // yearly targets snaps the period picker instead of letting you build a request
  // the API will refuse. Retention is the one that needs it — it comes from a
  // function that takes a year, so a monthly retention target is unmeasurable.
  const allowedGrains = selected?.grains ?? (['month', 'quarter', 'year'] as GoalGrain[])
  const effectiveGrain: GoalGrain = allowedGrains.includes(grain) ? grain : allowedGrains[0]
  // Shown before saving, because "which period is this?" is the thing an admin
  // gets wrong — a quarter set from a mid-quarter date is still that quarter.
  const bounds = /^\d{4}-\d{2}-\d{2}$/.test(periodStart) ? periodBounds(effectiveGrain, periodStart) : null

  /* ── editing ────────────────────────────────────────────────────────────────
   * Ben: "Currently I can create and delete but not edit."
   *
   * ⚠ The same form, loaded with the row, rather than a second inline editor. Every
   * guard this form already has — the person picker snapping back on a company-only
   * measure, the grain picker snapping back on a yearly-only one, the ceiling warning,
   * the period preview — has to apply to an edit too, and a separate editor would be a
   * second place for all of it to drift.
   */
  function startEdit(g: Goal) {
    setEditing(g)
    setMetric(g.metric)
    setGrain(g.grain)
    setPeriodStart(g.period_start)
    setTarget(String(g.target))
    setWho(g.employee_id ?? COMPANY)
    setRepeats(g.repeats)
    // The form sits above the list, so an edit that scrolled nowhere reads as a no-op.
    document.getElementById('goal-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function cancelEdit() {
    setEditing(null)
    setTarget('')
    setRepeats(true)
    setWho(COMPANY)
    setPeriodStart(thisMonthISO())
  }

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
      body: JSON.stringify({
        // ⚠ Present only when editing. Without an id the route upserts, which for a
        // changed period or person would ADD a row and leave the original standing —
        // two contradictory targets on one report.
        id: editing?.id,
        metric, grain: effectiveGrain, period_start: periodStart, target: value,
        employee_id: employeeId, repeats,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error || 'Could not save that target')
      return
    }
    toast.success(editing ? 'Target updated' : 'Target saved')
    setEditing(null)
    setTarget('')
    router.refresh()
  }

  async function remove(g: Goal) {
    const label = metrics.find(m => m.key === g.metric)?.label ?? g.metric
    const owner = g.employee_id ? `${g.person_name || 'that person'}'s ` : ''
    const ok = await confirm({
      title: 'Remove this target?',
      message: g.repeats
        ? `${owner}${label} will no longer apply to any ${GRAIN_NOUN[g.grain]} from ${periodLabel(g.grain, g.period_start)} onward. Targets you set for one specific ${GRAIN_NOUN[g.grain]} are not affected.`
        : `${owner}${label} for ${periodLabel(g.grain, g.period_start)} will no longer appear on the Goals report. Nothing else changes.`,
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
          What the business is aiming at, for the <strong className="text-gray-300">Goals &amp; Targets</strong> report. Each target is measured against its own period on the
          <strong className="text-gray-300"> Goals &amp; Targets</strong> report, using the same numbers the other
          reports show &mdash; so a goal can never disagree with the report it is judged against. Setting a target for
          a period that already has one replaces it. A target can belong to the whole company or to{' '}
          <strong className="text-gray-300">one person</strong>; the two are kept separate, so a company target and
          somebody&rsquo;s own target for the same measure can both exist. Use{' '}
          <strong className="text-gray-300">Edit</strong> on a saved target to change its number, its
          period, or who it belongs to.
        </p>
      </div>

      <div id="goal-form" className={`rounded-2xl border p-4 md:p-6 ${
        editing ? 'border-indigo-600/60 bg-indigo-500/5' : 'border-gray-800 bg-gray-900'}`}>
        {/* ⚠ A form that silently switched from "set" to "edit" is how somebody ends up
            duplicating a target instead of changing it. Said plainly, with a way out. */}
        {editing && (
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-indigo-200">
              Editing the <strong>{metrics.find(m => m.key === editing.metric)?.label ?? editing.metric}</strong>
              {' '}target for {editing.employee_id ? (editing.person_name || 'that person') : 'the whole company'}
              {' · '}{editing.repeats
                ? `every ${GRAIN_NOUN[editing.grain]} from ${periodLabel(editing.grain, editing.period_start)}`
                : periodLabel(editing.grain, editing.period_start)}
            </span>
            <button onClick={cancelEdit}
              className="text-xs text-gray-400 underline hover:text-gray-200">
              Cancel and set a new target instead
            </button>
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-5">
          <label className="block">
            <span className="text-xs text-gray-400">Measure</span>
            <select
              value={metric}
              onChange={e => setMetric(e.target.value)}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            >
              {/* Grouped: a flat list of 23 measures is unreadable, and the groups
                  are how somebody actually looks for one ("something about the
                  phone"). Order follows the catalog. */}
              {GOAL_METRIC_GROUPS.filter(gr => metrics.some(m => m.group === gr)).map(gr => (
                <optgroup key={gr} label={gr}>
                  {metrics.filter(m => m.group === gr).map(m => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-gray-400">Whose target</span>
            <select
              value={effectiveWho}
              onChange={e => setWho(e.target.value)}
              disabled={!personAllowed}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm disabled:opacity-60"
            >
              <option value={COMPANY}>The whole company</option>
              {roster.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name}{e.is_active ? '' : ' (no longer active)'}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-gray-400">Period</span>
            <select
              value={effectiveGrain}
              onChange={e => setGrain(e.target.value as GoalGrain)}
              disabled={allowedGrains.length === 1}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm disabled:opacity-60"
            >
              {allowedGrains.map(gr => (
                <option key={gr} value={gr}>{GRAIN_LABEL[gr]}</option>
              ))}
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
              {selected?.direction === 'lower' ? 'Target — at most' : 'Target'}{targetUnit(selected)}
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

        <label className="flex items-start gap-2 mt-4 cursor-pointer">
          <input
            type="checkbox"
            checked={repeats}
            onChange={e => setRepeats(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-sm">
            This is the target for <strong className="text-gray-300">every {GRAIN_NOUN[effectiveGrain]}</strong>
            <span className="text-gray-500">
              {' '}&mdash; set it once and it applies to each {GRAIN_NOUN[effectiveGrain]} from here on, judged
              separately. Untick to set a target for one {GRAIN_NOUN[effectiveGrain]} only.
            </span>
          </span>
        </label>

        {selected && <p className="text-gray-500 text-xs mt-3">{selected.help}</p>}
        {/* ⚠ A ceiling is the one thing about this form that can be misread as its
            opposite, so it is stated in the label, here, and again on the saved row. */}
        {selected?.direction === 'lower' && (
          <p className="text-amber-300/80 text-xs mt-1">
            This one is a <strong className="text-gray-300">ceiling, not a goal to reach</strong> &mdash; it counts as hit
            when the figure comes in at or below the number you type.
          </p>
        )}
        {selected?.format === 'duration' && (
          <p className="text-gray-500 text-xs mt-1">
            Type this in <strong className="text-gray-300">seconds</strong>: 30 is thirty seconds, 300 is five minutes.
          </p>
        )}
        {selected && selected.grains.length < 3 && (
          <p className="text-gray-500 text-xs mt-1">
            Only available {selected.grains.map(gr => GRAIN_LABEL[gr].toLowerCase()).join(' or ')}.
          </p>
        )}
        {selected && !selected.perPerson && (
          <p className="text-amber-300/80 text-xs mt-1">
            Company-wide only. {selected.perPersonBlocker}
          </p>
        )}
        {employeeId && (
          <p className="text-gray-500 text-xs mt-1">
            Measured from this person&rsquo;s own figures on the People report. They are credited only with work
            assigned to them, so individual targets will not add up to a company one.
          </p>
        )}
        {/* ⚠ Fires only once somebody is actually picked. A measure can be honest for a
            technician and meaningless for an office role, and the difference is invisible
            until you choose which. Amber, not red: this is a "know who this fits" note,
            not a refusal. */}
        {employeeId && selected?.perPersonCaution && (
          <p className="text-amber-300/80 text-xs mt-1">{selected.perPersonCaution}</p>
        )}
        {bounds && (
          <p className="text-sky-300/80 text-xs mt-1">
            {repeats ? (
              <>
                This target will cover <strong>{periodLabel(effectiveGrain, bounds.start)}</strong> ({bounds.start} to {bounds.end}){' '}
                <strong>and every {GRAIN_NOUN[effectiveGrain]} after it</strong>. Each one is judged on its own, and you
                can still set a different number for a single {GRAIN_NOUN[effectiveGrain]} later &mdash; that one wins.
              </>
            ) : (
              <>
                This target will cover <strong>{periodLabel(effectiveGrain, bounds.start)}</strong> only &mdash; {bounds.start} to {bounds.end}.
              </>
            )}
          </p>
        )}

        {/* ⚠ Only while editing, and only when the identity actually moved. Changing a
            target's period or owner does not edit the old period's number — it MOVES
            the target, leaving the original period with none. That is usually what
            somebody means, and occasionally very much not. */}
        {editing && bounds && (
          editing.period_start !== bounds.start
          || editing.grain !== effectiveGrain
          || (editing.employee_id ?? null) !== employeeId
          || editing.repeats !== repeats
        ) && (
          <p className="text-amber-300/80 text-xs mt-3">
            ⚠ This moves the target rather than changing its number:{' '}
            <strong className="text-gray-300">
              {editing.repeats
                ? `every ${GRAIN_NOUN[editing.grain]} from ${periodLabel(editing.grain, editing.period_start)}`
                : periodLabel(editing.grain, editing.period_start)}
              {editing.employee_id ? ` · ${editing.person_name || 'that person'}` : ' · the whole company'}
            </strong>{' '}
            will be left with no target at all. Set a new one for it if that is not what you want.
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm font-medium bg-brand hover:bg-brand-hover text-[#fff] disabled:opacity-60"
          >
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Save target'}
          </button>
          {editing && (
            <button onClick={cancelEdit}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:border-gray-600">
              Cancel
            </button>
          )}
        </div>
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
                      <span className="text-gray-500 font-normal">
                        {' · '}
                        {g.repeats
                          ? `every ${GRAIN_NOUN[g.grain]} from ${periodLabel(g.grain, g.period_start)}`
                          : periodLabel(g.grain, g.period_start)}
                      </span>
                    </div>
                    <div className="text-xs mt-0.5">
                      {g.employee_id
                        ? <span className="text-sky-300/80">{g.person_name || 'Someone no longer on the roster'}</span>
                        : <span className="text-gray-500">The whole company</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {m ? fmtTarget(m, g.target) : g.target}
                      {!m && ' · this measure is no longer available and will show as unknown on the report'}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <button
                      onClick={() => startEdit(g)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium border bg-gray-800 ${
                        editing?.id === g.id
                          ? 'border-indigo-600 text-indigo-300'
                          : 'border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'}`}
                    >
                      {editing?.id === g.id ? 'Editing' : 'Edit'}
                    </button>
                    <button
                      onClick={() => remove(g)}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium border bg-gray-800 border-gray-700 text-gray-400 hover:text-red-300 hover:border-red-800"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
