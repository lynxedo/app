'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast, useConfirm } from '@/components/ui'
import {
  BASIS_GROUPS, COMMISSION_BASES, describeRule, formatBasisAmount, getBasis,
  isBandedKind, isTargetKind, rateKindsFor,
  type CommissionBasisDef, type CommissionPlan, type RateKind,
} from '@/lib/reports/commission'

type Employee = { id: string; name: string; department: string | null; is_active: boolean }
type Plan = CommissionPlan & { person: string }

const RATE_KIND_LABEL: Record<RateKind, string> = {
  percent: 'A percentage of it',
  per_unit: 'A flat amount per unit',
  tiered: 'Tiered percentages',
  target_flat: 'A flat bonus for hitting a target',
  target_tiered: 'Stepped bonuses — the best band reached',
}

/**
 * The target field's label, in the direction the basis actually pays.
 *
 * ⚠ Read from the basis, exactly as `payout()` reads it. A ceiling labelled "pay when
 * it reaches" would invite somebody to type 25 meaning "keep it under 25" and get a
 * bonus that pays only in the worst months — the arithmetic would be right and the
 * screen would have lied about it.
 */
function targetLabel(def: CommissionBasisDef | null): string {
  return def?.better === 'lower' ? 'Pay when it is at or below' : 'Pay when it reaches'
}

/** "$100.00/hr" / "25%" — a real example in this basis's own units. */
function targetPlaceholder(def: CommissionBasisDef | null): string {
  return def?.unit === 'percent' ? '25' : '100'
}

/** The bands hint, written in the units and direction of the basis in hand. */
function bandHint(def: CommissionBasisDef | null): string {
  if (def?.better === 'lower') {
    return '30:100, 25:250 pays $100 at or below 30% and $250 at or below 25% — the best band only, never both.'
  }
  return '90:200, 100:400 pays $200 at $90 an hour and $400 at $100 an hour — the best band only, never both.'
}

const input = 'w-full rounded-md border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none'
const lbl = 'block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1'

export default function CommissionAdminPanel({
  employees, plans, lines, items,
}: {
  employees: Employee[]
  plans: Plan[]
  /** Service-line codes this company runs, for the line-revenue basis. */
  lines: string[]
  /** Lead Tracker Service values, for the item basis. */
  items: string[]
}) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()

  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? '')
  const [label, setLabel] = useState('')
  const [basis, setBasis] = useState(COMMISSION_BASES[0].key as string)
  const [rateKind, setRateKind] = useState<RateKind>('percent')
  const [rate, setRate] = useState('')
  const [tierText, setTierText] = useState('0:3, 50000:5')
  /* ⚠ A SECOND band field rather than reusing the first. The two mean different things
   * — "from:percent" against a running total, versus "target:dollars" against a ratio —
   * and the tiered default of `0:3, 50000:5` would read as "pay $3 at 0 an hour", which
   * the API rejects. Kept apart so switching basis can never carry the wrong numbers
   * across, and started EMPTY because a prefilled target is a target somebody didn't
   * choose, in the wrong direction half the time. */
  const [targetBandText, setTargetBandText] = useState('')
  const [threshold, setThreshold] = useState('')
  const [cap, setCap] = useState('')
  const [linePrefix, setLinePrefix] = useState(lines[0] ?? '')
  const [picked, setPicked] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const def = getBasis(basis)
  const allowedKinds = def ? rateKindsFor(def.unit) : (['percent'] as RateKind[])
  // Switching basis can invalidate the rate kind (a count cannot take a percentage),
  // so the selector is corrected here rather than letting the server reject the save.
  const effectiveKind: RateKind = allowedKinds.includes(rateKind) ? rateKind : allowedKinds[0]

  function parseTiers(text: string): { from: number; rate: number }[] {
    return text
      .split(',')
      .map(part => part.split(':'))
      .filter(p => p.length === 2)
      .map(([f, r]) => ({ from: Number(f.trim()), rate: Number(r.trim()) }))
      .filter(t => Number.isFinite(t.from) && Number.isFinite(t.rate))
  }

  async function save() {
    if (!employeeId) { toast.error('Pick a person'); return }
    if (!label.trim()) { toast.error('Give the rule a name'); return }
    setSaving(true)
    const res = await fetch('/api/admin/commission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: employeeId,
        label: label.trim(),
        basis,
        rate_kind: effectiveKind,
        // ⚠ Both banded kinds put their numbers in `tiers`, not just the old one. Sending
        // `rate` for a stepped target would fail the database's rate-present check.
        rate: isBandedKind(effectiveKind) ? undefined : rate,
        tiers: isBandedKind(effectiveKind)
          ? parseTiers(isTargetKind(effectiveKind) ? targetBandText : tierText)
          : undefined,
        threshold: threshold === '' ? null : threshold,
        // A cap cannot narrow a flat bonus into anything meaningful, so the field is
        // hidden for target rules and nothing is sent.
        cap: isTargetKind(effectiveKind) || cap === '' ? null : cap,
        line_prefix: def?.needs === 'line' ? linePrefix : undefined,
        items: def?.needs === 'items' ? picked : undefined,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error || 'Could not save that rule')
      return
    }
    toast.success('Rule saved')
    setLabel(''); setRate(''); setThreshold(''); setCap(''); setPicked([]); setTargetBandText('')
    router.refresh()
  }

  async function remove(plan: Plan) {
    const ok = await confirm({
      title: 'Delete this rule?',
      message: `“${plan.label}” for ${plan.person}. Commission figures for past periods will change too, because rules are not dated.`,
      confirmText: 'Delete',
      danger: true,
    })
    if (!ok) return
    const res = await fetch(`/api/admin/commission?id=${encodeURIComponent(plan.id)}`, { method: 'DELETE' })
    if (!res.ok) { toast.error('Could not delete that rule'); return }
    toast.success('Rule deleted')
    router.refresh()
  }

  async function toggle(plan: Plan) {
    const res = await fetch('/api/admin/commission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...plan, employee_id: plan.employee_id, active: !plan.active }),
    })
    if (!res.ok) { toast.error('Could not change that rule'); return }
    router.refresh()
  }

  const byPerson = new Map<string, Plan[]>()
  for (const p of plans) {
    const arr = byPerson.get(p.person) ?? []
    arr.push(p)
    byPerson.set(p.person, arr)
  }

  return (
    <section>
      <h2 className="text-lg font-bold tracking-tight text-white">Commission plans</h2>
      <p className="mt-1 max-w-3xl text-sm text-gray-400">
        One rule per line. A person can have several — that is how &ldquo;5% of irrigation sales
        <em> plus</em> $50 a controller&rdquo; is set up. Rules under <strong className="text-gray-200">Efficiency</strong>
        {' '}work differently: they pay a flat bonus for <em>hitting a target</em> — revenue per labour
        hour, or payroll as a share of production revenue — because there is no sensible percentage
        of a ratio. These feed the <strong className="text-gray-200">Commission</strong>
        {' '}cards you can add to any scoreboard; they are not a page of their own.
      </p>
      <p className="mt-2 max-w-3xl text-sm text-amber-300/80">
        Rules are not dated. Changing a rate changes what earlier periods report too, the same way
        the labour costing applies today&apos;s wage to an old week.
      </p>

      {/* ── new rule ── */}
      <div className="mt-5 rounded-lg border border-gray-800 bg-gray-900/40 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={lbl} htmlFor="cp-person">Person</label>
            <select id="cp-person" className={input} value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
              {employees.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name}{e.department ? ` · ${e.department}` : ''}{e.is_active ? '' : ' (former)'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="cp-label">Name for this rule</label>
            <input id="cp-label" className={input} value={label} onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Irrigation sales bonus" />
          </div>
          <div>
            <label className={lbl} htmlFor="cp-basis">Paid on</label>
            {/* Grouped: nine options in one flat list is a wall, and the three sales
                bases in particular only make sense read against each other. */}
            <select id="cp-basis" className={input} value={basis} onChange={e => setBasis(e.target.value)}>
              {BASIS_GROUPS.map(g => (
                <optgroup key={g} label={g}>
                  {COMMISSION_BASES.filter(b => b.group === g).map(b => (
                    <option key={b.key} value={b.key}>{b.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="cp-kind">How it pays</label>
            <select id="cp-kind" className={input} value={effectiveKind}
              onChange={e => setRateKind(e.target.value as RateKind)}>
              {allowedKinds.map(k => <option key={k} value={k}>{RATE_KIND_LABEL[k]}</option>)}
            </select>
          </div>
        </div>

        {def && (
          <p className="mt-3 text-xs text-gray-500">{def.hint}</p>
        )}
        {def?.caution && (
          <p className="mt-1.5 text-xs text-amber-300/80">⚠ {def.caution}</p>
        )}

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {effectiveKind === 'tiered' && (
            <div className="lg:col-span-2">
              <label className={lbl} htmlFor="cp-tiers">Bands</label>
              <input id="cp-tiers" className={input} value={tierText} onChange={e => setTierText(e.target.value)}
                placeholder="0:3, 50000:5" />
              <p className="mt-1 text-xs text-gray-500">
                <code>from:percent</code>, comma separated. <code>0:3, 50000:5</code> pays 3% on the
                first $50,000 and 5% on everything above it — marginal, not a cliff.
              </p>
            </div>
          )}
          {effectiveKind === 'target_tiered' && (
            <div className="lg:col-span-2">
              <label className={lbl} htmlFor="cp-target-bands">Bands</label>
              <input id="cp-target-bands" className={input} value={targetBandText}
                onChange={e => setTargetBandText(e.target.value)}
                placeholder={def?.better === 'lower' ? '30:100, 25:250' : '90:200, 100:400'} />
              <p className="mt-1 text-xs text-gray-500">
                <code>target:bonus</code>, comma separated. {bandHint(def)}
              </p>
            </div>
          )}
          {!isBandedKind(effectiveKind) && (
            <div>
              <label className={lbl} htmlFor="cp-rate">
                {effectiveKind === 'percent' ? 'Percentage'
                  : effectiveKind === 'target_flat' ? 'Bonus amount ($)'
                    : 'Amount per unit'}
              </label>
              <input id="cp-rate" className={input} type="number" min="0" step="0.01"
                value={rate} onChange={e => setRate(e.target.value)}
                placeholder={effectiveKind === 'percent' ? '5' : effectiveKind === 'target_flat' ? '500' : '50'} />
            </div>
          )}

          {def?.needs === 'line' && (
            <div>
              <label className={lbl} htmlFor="cp-line">Service line</label>
              <select id="cp-line" className={input} value={linePrefix} onChange={e => setLinePrefix(e.target.value)}>
                {lines.length === 0 && <option value="">No service lines found</option>}
                {lines.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          )}

          {/* ⚠⚠ ON A FLAT TARGET RULE THIS FIELD *IS* THE TARGET, and it is required.
              Left blank there is no line to clear, and a comparison against no line is
              one everybody passes — the rule would quietly pay its full amount to every
              holder every period. On a stepped rule the bands carry the targets, so the
              field is hidden rather than left to contradict them. */}
          {effectiveKind !== 'target_tiered' && (
            <div>
              <label className={lbl} htmlFor="cp-threshold">
                {effectiveKind === 'target_flat'
                  ? `${targetLabel(def)}${def?.unit === 'percent' ? ' (%)' : ' ($/hr)'}`
                  : 'Nothing until (optional)'}
              </label>
              <input id="cp-threshold" className={input} type="number" min="0" step={effectiveKind === 'target_flat' ? '0.01' : '1'}
                value={threshold} onChange={e => setThreshold(e.target.value)}
                placeholder={effectiveKind === 'target_flat' ? targetPlaceholder(def) : '—'} />
              {effectiveKind === 'target_flat' && threshold !== '' && Number(threshold) > 0 && (
                <p className="mt-1 text-xs text-gray-500">
                  Pays {rate === '' ? 'the bonus' : `$${Number(rate).toLocaleString('en-US')}`} when{' '}
                  {def?.noun} is {def?.better === 'lower' ? 'at or below' : 'at or above'}{' '}
                  {formatBasisAmount(def, Number(threshold))}.
                </p>
              )}
            </div>
          )}
          {/* A cap cannot narrow a flat bonus into anything meaningful — it would either
              do nothing or silently pay less than the rule says. Not offered. */}
          {!isTargetKind(effectiveKind) && (
            <div>
              <label className={lbl} htmlFor="cp-cap">Cap the payout at (optional)</label>
              <input id="cp-cap" className={input} type="number" min="0" step="1"
                value={cap} onChange={e => setCap(e.target.value)} placeholder="—" />
            </div>
          )}
        </div>
        {isTargetKind(effectiveKind) && (
          <p className="mt-3 text-xs text-amber-300/80">
            ⚠ A target is all-or-nothing on purpose. Nothing is prorated and nothing is
            marginal: {def?.better === 'lower' ? 'a hair over the ceiling' : 'a cent under the target'} pays
            zero{effectiveKind === 'target_tiered' ? ', and only the best band reached is paid — never two at once' : ''}.
            The card shows the figure against the target so a miss reads as a miss rather than as a broken number.
          </p>
        )}

        {def?.needs === 'items' && (
          <div className="mt-3">
            <span className={lbl}>Which items</span>
            {items.length === 0
              ? <p className="text-xs text-gray-500">No Service values found in the Lead Tracker yet.</p>
              : (
                <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                  {items.map(v => {
                    const on = picked.includes(v)
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setPicked(on ? picked.filter(x => x !== v) : [...picked, v])}
                        className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                          on
                            ? 'border-indigo-500 bg-indigo-500/20 text-indigo-200'
                            : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600'
                        }`}
                      >{v}</button>
                    )
                  })}
                </div>
              )}
          </div>
        )}

        <div className="mt-4">
          <button onClick={save} disabled={saving}
            className="rounded-md bg-brand px-3.5 py-1.5 text-sm font-semibold text-[#fff] hover:bg-brand-hover disabled:opacity-50">
            {saving ? 'Saving…' : 'Add rule'}
          </button>
        </div>
      </div>

      {/* ── existing rules ── */}
      <div className="mt-6 space-y-5">
        {plans.length === 0 && (
          <p className="text-sm text-gray-500">
            No rules yet. Until one exists the Commission cards show nothing, which is why they are
            not on any board by default.
          </p>
        )}
        {[...byPerson.entries()].map(([person, rules]) => (
          <div key={person}>
            <div className="mb-1.5 text-sm font-semibold text-gray-200">{person}</div>
            <div className="overflow-hidden rounded-lg border border-gray-800">
              {rules.map(p => (
                <div key={p.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-800 px-3 py-2 last:border-b-0">
                  <span className={`text-sm ${p.active ? 'text-gray-200' : 'text-gray-500 line-through'}`}>
                    {p.label}
                  </span>
                  <span className="text-xs text-gray-500">{describeRule(p)}</span>
                  <div className="ml-auto flex items-center gap-2">
                    <button onClick={() => toggle(p)}
                      className="text-xs text-gray-500 transition-colors hover:text-gray-200">
                      {p.active ? 'Switch off' : 'Switch on'}
                    </button>
                    <button onClick={() => remove(p)}
                      className="text-xs text-red-400/70 transition-colors hover:text-red-300">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
