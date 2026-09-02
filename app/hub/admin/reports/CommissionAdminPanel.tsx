'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast, useConfirm } from '@/components/ui'
import {
  BASIS_GROUPS, COMMISSION_BASES, COMMISSION_PERIODS, TIER_MODES,
  describeRule, formatBasisAmount, getBasis,
  isBandedKind, isTargetKind, rateKindsFor,
  type CommissionBasisDef, type CommissionPeriod, type CommissionPlan, type RateKind,
  type TierMode,
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
  /* ⚠ Every one of these starts at TODAY'S BEHAVIOUR, so a rule typed without touching
   * them is the rule this screen has always written. */
  const [period, setPeriod] = useState<CommissionPeriod>('month')
  const [tierMode, setTierMode] = useState<TierMode>('marginal')
  const [verify, setVerify] = useState(false)
  const [minPrice, setMinPrice] = useState('')
  const [excludeRenewals, setExcludeRenewals] = useState(false)
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [effectiveTo, setEffectiveTo] = useState('')
  /** The rule being edited, or null when the form is adding a new one. */
  const [editing, setEditing] = useState<Plan | null>(null)
  /* ⚠ Superseding rather than overwriting: the default when a pay-affecting field
   * changes, because overwriting silently repays every month already closed. */
  const [supersede, setSupersede] = useState(true)
  const [supersedeFrom, setSupersedeFrom] = useState('')

  const def = getBasis(basis)
  const allowedKinds = def ? rateKindsFor(def.unit) : (['percent'] as RateKind[])
  // Switching basis can invalidate the rate kind (a count cannot take a percentage),
  // so the selector is corrected here rather than letting the server reject the save.
  const effectiveKind: RateKind = allowedKinds.includes(rateKind) ? rateKind : allowedKinds[0]

  /* ⚠⚠ ONLY THE TWO PRODUCTION BASES HAVE WEEKLY FIGURES BEHIND THEM, because only
   * `scoreboard_commission_production` returns per-week buckets. Same reasoning as the
   * rate-kind correction above: the picker snaps back rather than letting somebody
   * build a rule the API will refuse — and a weekly rule that silently fell back to
   * monthly would be the very bug this release fixes. */
  const canUseWeeks = basis === 'revenue_produced' || basis === 'rev_per_hour'
  const effectivePeriod: CommissionPeriod = canUseWeeks ? period : 'month'
  // Verification is per-unit evidence, so it only means anything on a counted basis.
  const canVerify = def?.needs === 'items'
  const effectiveVerify = canVerify && verify

  /**
   * Has this edit changed what the rule PAYS?
   *
   * ⚠ Only these fields matter. Renaming a rule, switching it off, or reordering it
   * does not change any past figure, so offering to version it would be noise — and a
   * prompt that fires on every edit gets clicked through without being read.
   */
  const payAffectingChange = (() => {
    if (!editing) return false
    const bands = isTargetKind(effectiveKind) ? targetBandText : tierText
    const editingBands = (editing.tiers ?? []).map(t => `${t.from}:${t.rate}`).join(', ')
    const num = (v: string) => (v === '' ? null : Number(v))
    return editing.basis !== basis
      || editing.rate_kind !== effectiveKind
      || (editing.rate ?? null) !== num(rate)
      || (isBandedKind(effectiveKind) && bands.replace(/\s/g, '') !== editingBands.replace(/\s/g, ''))
      || (editing.threshold ?? null) !== num(threshold)
      || (editing.cap ?? null) !== num(cap)
      || editing.period !== effectivePeriod
      || editing.tier_mode !== tierMode
      || (editing.verify_source === 'invoice') !== effectiveVerify
      || (editing.min_price ?? null) !== (effectiveVerify ? num(minPrice) : null)
      || editing.exclude_renewals !== (effectiveVerify && excludeRenewals)
      || (editing.items ?? []).slice().sort().join('|') !== picked.slice().sort().join('|')
      || (editing.line_prefix ?? null) !== (def?.needs === 'line' ? linePrefix : null)
  })()

  /** Load a rule into the form. */
  function startEdit(p: Plan) {
    setEditing(p)
    setEmployeeId(p.employee_id)
    setLabel(p.label)
    setBasis(p.basis)
    setRateKind(p.rate_kind)
    setRate(p.rate == null ? '' : String(p.rate))
    const bands = (p.tiers ?? []).map(t => `${t.from}:${t.rate}`).join(', ')
    if (isTargetKind(p.rate_kind)) setTargetBandText(bands)
    else if (bands) setTierText(bands)
    setThreshold(p.threshold == null ? '' : String(p.threshold))
    setCap(p.cap == null ? '' : String(p.cap))
    setLinePrefix(p.line_prefix ?? lines[0] ?? '')
    setPicked(p.items ?? [])
    setPeriod(p.period)
    setTierMode(p.tier_mode)
    setVerify(p.verify_source === 'invoice')
    setMinPrice(p.min_price == null ? '' : String(p.min_price))
    setExcludeRenewals(p.exclude_renewals)
    setEffectiveFrom(p.effective_from ?? '')
    setEffectiveTo(p.effective_to ?? '')
    setSupersede(true)
    // Defaults to today: a rate change you are making now takes effect now, and
    // everything before today keeps the rule it was actually paid under.
    setSupersedeFrom(new Date().toISOString().slice(0, 10))
    // The form sits above the list; an edit that scrolled nowhere reads as a no-op.
    document.getElementById('cp-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function resetForm() {
    setEditing(null)
    setLabel(''); setRate(''); setThreshold(''); setCap(''); setPicked([]); setTargetBandText('')
    setPeriod('month'); setTierMode('marginal'); setVerify(false); setMinPrice('')
    setExcludeRenewals(false); setEffectiveFrom(''); setEffectiveTo('')
    setSupersede(true); setSupersedeFrom('')
  }

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
        // ⚠ Present only when editing, so an absent id still means "insert" — the
        // route branches on exactly that.
        id: editing?.id,
        employee_id: employeeId,
        label: label.trim(),
        basis,
        rate_kind: effectiveKind,
        period: effectivePeriod,
        tier_mode: tierMode,
        verify_source: effectiveVerify ? 'invoice' : null,
        min_price: effectiveVerify && minPrice !== '' ? minPrice : null,
        exclude_renewals: effectiveVerify && excludeRenewals,
        effective_from: effectiveFrom || null,
        effective_to: effectiveTo || null,
        /* ⚠ Only sent when this edit actually changes what the rule pays AND the
         * admin left the default on. Absent, the route overwrites in place, which is
         * right for a rename or a switch-off. */
        supersede_from: editing && payAffectingChange && supersede ? supersedeFrom : undefined,
        // Editing must not silently switch a rule back on.
        active: editing ? editing.active : true,
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
    toast.success(
      editing
        ? (payAffectingChange && supersede
            ? `New version starts ${supersedeFrom} — earlier periods keep the old rate`
            : 'Rule updated')
        : 'Rule saved')
    resetForm()
    router.refresh()
  }

  async function remove(plan: Plan) {
    const ok = await confirm({
      title: 'Delete this rule?',
      message: plan.effective_from || plan.effective_to
        ? `“${plan.label}” for ${plan.person}. It is dated, so only the periods it covers change.`
        : `“${plan.label}” for ${plan.person}. This rule carries no dates, so commission figures for earlier periods change too — set “in force from/until” instead if you only want to stop it going forward.`,
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
      <p className="mt-2 max-w-3xl text-sm text-gray-400">
        A rule can now be <strong className="text-gray-200">dated</strong>. Leave the dates blank and
        it applies to every period, which is how every rule worked before &mdash; but that also means
        changing its rate changes what <em>earlier</em> periods report. Once a month is paid, set
        {' '}<strong className="text-gray-200">in force until</strong> on the old rule and add a new one
        starting the next day; both then stay reproducible.
      </p>

      {/* ── new rule / editing an existing one ── */}
      <div id="cp-form" className={`mt-5 rounded-lg border p-4 ${
        editing ? 'border-indigo-600/60 bg-indigo-500/5' : 'border-gray-800 bg-gray-900/40'}`}>
        {/* ⚠ A form that silently switches from "add" to "edit" is how somebody
            duplicates a rule instead of changing it. Said plainly, with a way out. */}
        {editing && (
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-indigo-200">
              Editing <strong>{editing.label}</strong> for {editing.person}
            </span>
            <button type="button" onClick={resetForm}
              className="text-xs text-gray-400 underline transition-colors hover:text-gray-200">
              Cancel and add a new rule instead
            </button>
          </div>
        )}
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

        {/* ── how the period is cut ─────────────────────────────────────────────
            ⚠ Only offered on the two production bases, because only they have weekly
            figures behind them. On every other basis the control would be a lie. */}
        {canUseWeeks && (
          <div className="mt-3 rounded-md border border-gray-800 bg-gray-900/60 p-3">
            <label className={lbl} htmlFor="cp-period">Measured over</label>
            <select id="cp-period" className={input} value={effectivePeriod}
              onChange={e => setPeriod(e.target.value as CommissionPeriod)}>
              {COMMISSION_PERIODS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <p className="mt-1.5 text-xs text-gray-500">
              {COMMISSION_PERIODS.find(o => o.key === effectivePeriod)?.hint}
            </p>
            {/* ⚠⚠ THE WARNING THAT USED TO LIVE HERE IS DELETED, and its absence is the
                point. It said four bonus weeks cover 28 days so a longer month leaves
                days in no bonus week at all — true of the old rule, and the bug that
                was fixed. Leaving it would be telling an admin to distrust a figure
                that has just become complete. What replaces it is what IS now true. */}
            {effectivePeriod !== 'month' && (
              <p className="mt-1.5 text-xs text-gray-500">
                Weeks run Monday to Sunday, and a week straddling the 1st belongs to whichever
                month holds more of its days &mdash; so a month has <strong className="text-gray-300">four
                or five</strong> bonus weeks and every day of the year falls in exactly one of them.
                The card says how many it used.
              </p>
            )}
          </div>
        )}

        {/* ⚠⚠ THE TIER SHAPE. Getting this wrong is an 8x pay error on Ben's own bands
            ($24.31 flat against $3.06 marginal on one real week), and the two are
            indistinguishable on a payslip — so both options are spelled out rather
            than one being a checkbox. */}
        {effectiveKind === 'tiered' && (
          <div className="mt-3 rounded-md border border-gray-800 bg-gray-900/60 p-3">
            <label className={lbl} htmlFor="cp-tier-mode">How the bands pay</label>
            <select id="cp-tier-mode" className={input} value={tierMode}
              onChange={e => setTierMode(e.target.value as TierMode)}>
              {TIER_MODES.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <p className="mt-1.5 text-xs text-gray-500">
              {TIER_MODES.find(o => o.key === tierMode)?.hint}
            </p>
          </div>
        )}

        {/* ── in force from / until ── */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={lbl} htmlFor="cp-from">In force from (optional)</label>
            <input id="cp-from" className={input} type="date" value={effectiveFrom}
              onChange={e => setEffectiveFrom(e.target.value)} />
          </div>
          <div>
            <label className={lbl} htmlFor="cp-to">In force until (optional)</label>
            <input id="cp-to" className={input} type="date" value={effectiveTo}
              onChange={e => setEffectiveTo(e.target.value)} />
          </div>
        </div>
        <p className="mt-1.5 text-xs text-gray-500">
          Blank on both means the rule applies to every period, past and future. Dating it is how a
          month that has already been paid stops moving when you change a rate.
        </p>

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

        {/* ── proof that a counted unit was really a sale ─────────────────────────
            ⚠⚠ THIS IS OFF BY DEFAULT, and that is not timidity: switching it on
            changes what a rule pays, so it has to be a decision somebody made. The
            Gold spiff is the case it was built for — a $400 plan recurs every year, so
            eleven Gold invoices in one month were nine renewals, one new member and
            one part-year plan, and counting tracker rows paid for all of them. */}
        {canVerify && (
          <div className="mt-3 rounded-md border border-gray-800 bg-gray-900/60 p-3">
            <label className="flex cursor-pointer items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={verify}
                onChange={e => setVerify(e.target.checked)} />
              <span className="text-sm text-gray-300">
                Only count a sale when a <strong className="text-gray-200">real invoice</strong> backs it
                <span className="block text-xs text-gray-500">
                  Matches the item against invoices issued in the period for that customer. A tracker
                  row with no invoice behind it &mdash; a stale row, or one keyed against the wrong
                  customer &mdash; stops paying, and the card says why rather than just showing fewer.
                </span>
              </span>
            </label>

            {verify && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={lbl} htmlFor="cp-minprice">The least a sale can be worth ($)</label>
                  <input id="cp-minprice" className={input} type="number" min="0" step="0.01"
                    value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="390" />
                  {/* ⚠ The one thing about this field that is genuinely surprising, so it
                      is stated: the item NAME does not separate a sale from a member
                      visit. Both are "…Service Plan Gold - T1"; only the price differs. */}
                  <p className="mt-1 text-xs text-gray-500">
                    Price is what separates a sale from a visit. The same item name covers a $400 plan,
                    a part-year plan, a $100 prepaid visit and a $0 included visit &mdash; and the
                    &ldquo;- T1&rdquo; suffix appears on both the real sale and the visit, so it cannot
                    be used. Leave blank to accept any price, including $0.
                  </p>
                </div>
                <div>
                  <label className="flex cursor-pointer items-start gap-2 pt-5">
                    <input type="checkbox" className="mt-0.5" checked={excludeRenewals}
                      onChange={e => setExcludeRenewals(e.target.checked)} />
                    <span className="text-sm text-gray-300">
                      New customers only &mdash; not renewals
                      <span className="block text-xs text-gray-500">
                        Drops a sale whose customer already had this item before the period started.
                        Checked against past invoices <em>and</em> past visits, because a member&apos;s
                        included visits are often the only record that far back.
                      </span>
                    </span>
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── superseding vs overwriting ─────────────────────────────────────────
            ⚠⚠ SHOWN ONLY WHEN THE EDIT CHANGES WHAT THE RULE PAYS, and ON by default.
            Overwriting a rate silently repays every month already closed, which is how
            April 2026's flat $35-per-upsell became unreproducible once the rule became
            5%. A prompt that fired on every edit — including renames — would be clicked
            through unread, so it fires only when it matters. */}
        {editing && payAffectingChange && (
          <div className="mt-3 rounded-md border border-amber-700/50 bg-amber-500/5 p-3">
            <label className="flex cursor-pointer items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={supersede}
                onChange={e => setSupersede(e.target.checked)} />
              <span className="text-sm text-gray-200">
                This is a <strong className="text-white">rate change</strong> &mdash; keep earlier periods as they were
                <span className="block text-xs text-gray-400">
                  Closes the current version the day before the date below and starts a new one from it.
                  Months already paid keep reading the rule they were actually paid under.
                </span>
              </span>
            </label>
            {supersede ? (
              <div className="mt-3 sm:max-w-xs">
                <label className={lbl} htmlFor="cp-supersede">The new rate starts on</label>
                <input id="cp-supersede" className={input} type="date" value={supersedeFrom}
                  onChange={e => setSupersedeFrom(e.target.value)} />
                <p className="mt-1 text-xs text-gray-500">
                  Everything up to{' '}
                  <strong className="text-gray-300">
                    {supersedeFrom
                      ? new Date(`${supersedeFrom}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                      : 'the day before'}
                  </strong>{' '}
                  keeps the current rule; from that day on, the rule you have typed above applies.
                  You will see two versions of it in the list.
                </p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-amber-300/90">
                ⚠ Unticked, this <strong className="text-gray-200">overwrites the rule everywhere</strong> &mdash;
                every earlier period will be recalculated at the new rate, including months you have already paid.
                Only do that when you are correcting a mistake rather than changing a rate.
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button onClick={save} disabled={saving}
            className="rounded-md bg-brand px-3.5 py-1.5 text-sm font-semibold text-[#fff] hover:bg-brand-hover disabled:opacity-50">
            {saving ? 'Saving…'
              : editing ? (payAffectingChange && supersede ? 'Start a new version' : 'Save changes')
                : 'Add rule'}
          </button>
          {editing && (
            <button type="button" onClick={resetForm}
              className="rounded-md border border-gray-700 px-3.5 py-1.5 text-sm text-gray-300 hover:border-gray-600">
              Cancel
            </button>
          )}
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
                  {/* A closed version is stated plainly: it is not "off", it covered a
                      period that has ended, and its figures for that period still stand. */}
                  {p.effective_to && (
                    <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[11px] text-gray-400">
                      past version
                    </span>
                  )}
                  {(p.effective_from || p.effective_to) && (
                    <span className="text-xs text-sky-300/80">
                      {p.effective_from && p.effective_to
                        ? `in force ${p.effective_from} → ${p.effective_to}`
                        : p.effective_from ? `from ${p.effective_from}` : `until ${p.effective_to}`}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <button onClick={() => startEdit(p)}
                      className={`text-xs transition-colors ${
                        editing?.id === p.id ? 'text-indigo-300' : 'text-gray-500 hover:text-gray-200'}`}>
                      {editing?.id === p.id ? 'Editing' : 'Edit'}
                    </button>
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
