'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast, useConfirm } from '@/components/ui'

/* What the business spends per marketing channel, per month.
 *
 * ⚠ This screen exists because NOTHING else in the platform knows what marketing
 * costs. There is no Google Ads or Angi spend feed, so until somebody types a number
 * here the Channel Scorecard can only show the volume half — leads, close rate,
 * revenue — and cost per lead, cost per customer and return on ad spend stay blank.
 *
 * ⚠ The channel list is the tenant's own `lead_sources_master`, not free text, because
 * the scorecard joins spend to lead and revenue rows on this exact string. A typo
 * would store real money against a channel that matches nothing — spend recorded,
 * counted nowhere, no error. The API re-checks the same thing server-side.
 */

export type SpendRow = {
  id: string
  source: string
  period_start: string
  amount: number
  notes: string | null
}

/** "2026-08-01" → "August 2026". */
function monthLabel(iso: string): string {
  const [y, m] = iso.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default function MarketingSpendPanel({
  sources,
  rows,
}: {
  /** The tenant's master lead sources — what spend may be filed against. */
  sources: string[]
  rows: SpendRow[]
}) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()

  const [source, setSource] = useState(sources[0] ?? '')
  // Defaults to LAST month, not this one: spend is entered in arrears once the invoice
  // is known, and defaulting to a month still running invites a half-month figure
  // being compared against a half-month of leads.
  const [month, setMonth] = useState(() => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  /* Grouped by month, newest first — how somebody checks "did I enter August yet".
   * A flat list sorted by channel makes that question need a search. */
  const byMonth = useMemo(() => {
    const m = new Map<string, SpendRow[]>()
    for (const r of rows) (m.get(r.period_start) ?? m.set(r.period_start, []).get(r.period_start)!).push(r)
    return [...m.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([period, list]) => ({
        period,
        list: [...list].sort((a, b) => b.amount - a.amount),
        total: list.reduce((s, r) => s + Number(r.amount || 0), 0),
      }))
  }, [rows])

  // Shown next to the input so re-entering a month reads as an update, not a duplicate.
  const existing = rows.find(
    r => r.source === source && r.period_start === `${month}-01`,
  )

  async function save() {
    const value = Number(amount)
    if (!Number.isFinite(value) || value < 0) {
      toast.error('Enter a spend of zero or more')
      return
    }
    setSaving(true)
    const res = await fetch('/api/admin/marketing-spend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, month, amount: value, notes }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error || 'Could not save that spend')
      return
    }
    setAmount('')
    setNotes('')
    toast.success(existing ? 'Spend updated' : 'Spend saved')
    router.refresh()
  }

  async function remove(r: SpendRow) {
    const ok = await confirm({
      title: 'Remove this spend?',
      message: `${r.source} for ${monthLabel(r.period_start)} (${money(Number(r.amount))}) will no longer count towards cost per lead or return on ad spend. Nothing else changes.`,
      confirmText: 'Remove',
      danger: true,
    })
    if (!ok) return
    const res = await fetch(`/api/admin/marketing-spend?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error || 'Could not remove that spend')
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Marketing spend</h1>
        <p className="text-gray-500 text-sm mt-1">
          What you pay each channel, month by month. Nothing else in Lynxedo knows this &mdash; there is no spend feed
          from Google or Angi &mdash; so the <strong className="text-gray-300">Marketing Channel Scorecard</strong> can
          only show leads, close rate and revenue until you fill these in. Once a month is entered, that card can also
          show <strong className="text-gray-300">cost per lead</strong>,{' '}
          <strong className="text-gray-300">cost per customer</strong> and{' '}
          <strong className="text-gray-300">return on ad spend</strong>. Enter each month once it is finished, using
          what you were actually billed. A card counts every month that <em>starts</em> inside its date range.
        </p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 md:p-6">
        <div className="grid gap-4 md:grid-cols-5">
          <label className="block md:col-span-2">
            <span className="text-xs text-gray-400">Channel</span>
            <select
              value={source}
              onChange={e => setSource(e.target.value)}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            >
              {sources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-gray-400">Month</span>
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-xs text-gray-400">Spend</span>
            <input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            />
          </label>

          <div className="flex items-end">
            <button
              onClick={save}
              disabled={saving || !source}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-medium"
            >
              {saving ? 'Saving…' : existing ? 'Update' : 'Save'}
            </button>
          </div>
        </div>

        <label className="block mt-4">
          <span className="text-xs text-gray-400">Note (optional)</span>
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. includes $200 setup fee"
            className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
          />
        </label>

        {existing && (
          <p className="text-amber-400/90 text-xs mt-3">
            {source} already has {money(Number(existing.amount))} recorded for {monthLabel(existing.period_start)}.
            Saving replaces it.
          </p>
        )}
      </div>

      {byMonth.length === 0 ? (
        <p className="text-gray-500 text-sm">
          No spend recorded yet. Until there is, the scorecard shows leads, close rate and revenue but leaves the cost
          columns off entirely.
        </p>
      ) : (
        <div className="space-y-4">
          {byMonth.map(({ period, list, total }) => (
            <div key={period} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="flex items-baseline justify-between px-4 py-3 border-b border-gray-800">
                <h2 className="text-sm font-medium">{monthLabel(period)}</h2>
                <span className="text-gray-400 text-sm">{money(total)}</span>
              </div>
              <ul className="divide-y divide-gray-800">
                {list.map(r => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="flex-1 text-sm">{r.source}</span>
                    {r.notes && <span className="text-gray-500 text-xs hidden md:inline">{r.notes}</span>}
                    <span className="text-sm tabular-nums">{money(Number(r.amount))}</span>
                    <button
                      onClick={() => remove(r)}
                      className="text-gray-500 hover:text-red-400 text-xs"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
