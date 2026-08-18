'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast, useConfirm } from '@/components/ui'

export type ProgramRow = {
  id: string
  line_item_name: string
  display_name: string
  dept_prefix: string
  is_auxiliary: boolean
  /** Column is `visits_per_year` for history; the number means ROUNDS. */
  rounds_per_year: number | null
  live_jobs: number
  measured_typical: number | null
  measured_min: number | null
  measured_max: number | null
}

export type UnmappedRow = {
  line_item_name: string
  live_jobs: number
  per_visit_total: number
  guessed_prefix: string | null
}

const input = 'w-full rounded-md border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none'
const lbl = 'block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1'

function money(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

/** What to say about a program's declared number versus what its jobs actually do. */
function cadenceNote(p: ProgramRow): { tone: 'ok' | 'warn' | 'quiet'; text: string } {
  if (p.is_auxiliary) return { tone: 'quiet', text: 'Follows its base program' }
  if (p.rounds_per_year == null) {
    return { tone: 'warn', text: 'No number set — these jobs price at $0' }
  }
  if (p.live_jobs === 0) return { tone: 'quiet', text: 'No live jobs' }
  if (p.measured_typical == null) return { tone: 'quiet', text: 'Nothing scheduled to compare' }
  if (p.measured_typical === p.rounds_per_year) return { tone: 'ok', text: 'Matches the schedule' }
  return {
    tone: 'warn',
    text: `Set to ${p.rounds_per_year}, but the schedule shows ${p.measured_typical}`,
  }
}

export default function RecurringProgramsPanel({
  programs, unmapped, lines,
}: {
  programs: ProgramRow[]
  unmapped: UnmappedRow[]
  /** Service-line codes already in use, offered as the default choices. */
  lines: string[]
}) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()

  const [editing, setEditing] = useState<string | null>(null)
  const [lineItem, setLineItem] = useState('')
  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState(lines[0] ?? '')
  const [isAddOn, setIsAddOn] = useState(false)
  const [rounds, setRounds] = useState('')
  const [saving, setSaving] = useState(false)
  const [showUnmapped, setShowUnmapped] = useState(false)

  function startAdd(fromItem?: UnmappedRow) {
    setEditing('new')
    setLineItem(fromItem?.line_item_name ?? '')
    setName(fromItem ? fromItem.line_item_name.replace(/^[A-Z]{2,3}\s*-\s*/, '') : '')
    setPrefix(fromItem?.guessed_prefix ?? lines[0] ?? '')
    setIsAddOn(false)
    setRounds('')
  }

  function startEdit(p: ProgramRow) {
    setEditing(p.id)
    setLineItem(p.line_item_name)
    setName(p.display_name)
    setPrefix(p.dept_prefix)
    setIsAddOn(p.is_auxiliary)
    setRounds(p.rounds_per_year == null ? '' : String(p.rounds_per_year))
  }

  async function save() {
    if (!lineItem.trim()) { toast.error('Pick the Jobber line item'); return }
    if (!name.trim()) { toast.error('Give the program a name'); return }
    setSaving(true)
    const res = await fetch('/api/admin/recurring-programs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editing === 'new' ? undefined : editing,
        line_item_name: lineItem.trim(),
        display_name: name.trim(),
        dept_prefix: prefix.trim(),
        is_auxiliary: isAddOn,
        rounds_per_year: isAddOn ? null : rounds,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error || 'Could not save that program')
      return
    }
    toast.success('Program saved')
    setEditing(null)
    router.refresh()
  }

  async function remove(p: ProgramRow) {
    const ok = await confirm({
      title: `Remove ${p.display_name}?`,
      message: p.live_jobs > 0
        ? `${p.live_jobs} live job${p.live_jobs === 1 ? '' : 's'} carry this line item. Removing the program drops ${p.live_jobs === 1 ? 'it' : 'them'} out of the recurring book entirely — the jobs and their money in Jobber are untouched, but they stop being counted here.`
        : 'No live jobs use this one, so nothing in the book changes.',
      confirmText: 'Remove',
      danger: true,
    })
    if (!ok) return
    const res = await fetch(`/api/admin/recurring-programs?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' })
    if (!res.ok) { toast.error('Could not remove that program'); return }
    toast.success('Program removed')
    router.refresh()
  }

  const byLine = new Map<string, ProgramRow[]>()
  for (const p of programs) {
    const arr = byLine.get(p.dept_prefix) ?? []
    arr.push(p)
    byLine.set(p.dept_prefix, arr)
  }
  const problems = programs.filter(p => cadenceNote(p).tone === 'warn').length

  return (
    <section>
      <h2 className="text-lg font-bold tracking-tight text-white">Recurring programs</h2>
      <p className="mt-1 max-w-3xl text-sm text-gray-400">
        Which Jobber line items count as recurring revenue, and how many times a year each one
        is charged. This is what the Book Size, Book Value and Program Mix cards are built from —
        a program with no number set prices at <span className="text-gray-200">$0</span>.
      </p>
      <p className="mt-2 max-w-3xl text-sm text-gray-400">
        <span className="font-semibold text-gray-200">Rounds, not visits.</span> On a larger
        property a single round can span two days — the crew comes back the next morning and that
        second visit bills nothing. Count what the customer is charged for.
      </p>

      {problems > 0 && (
        <p className="mt-3 rounded-md border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
          {problems} program{problems === 1 ? '' : 's'} below {problems === 1 ? 'needs' : 'need'} a look —
          either no number is set, or the number disagrees with what is actually on the schedule.
        </p>
      )}

      <div className="mt-5 space-y-8">
        {[...byLine.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([line, rows]) => (
          <div key={line}>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">{line}</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-[11px] uppercase tracking-wider text-gray-500">
                    <th className="py-2 pr-4">Program</th>
                    <th className="py-2 pr-4">Jobber line item</th>
                    <th className="py-2 pr-4 text-right">Charged/yr</th>
                    <th className="py-2 pr-4 text-right">On the schedule</th>
                    <th className="py-2 pr-4 text-right">Jobs</th>
                    <th className="py-2 pr-4">&nbsp;</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(p => {
                    const note = cadenceNote(p)
                    return (
                      <tr key={p.id} className="border-b border-gray-900">
                        <td className="py-2 pr-4">
                          <div className="font-medium text-gray-100">{p.display_name}</div>
                          <div className={
                            note.tone === 'warn' ? 'text-xs text-amber-300'
                            : note.tone === 'ok' ? 'text-xs text-gray-500'
                            : 'text-xs text-gray-500'
                          }>
                            {p.is_auxiliary && <span className="mr-1 text-gray-400">Add-on ·</span>}
                            {note.text}
                          </div>
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs text-gray-400">{p.line_item_name}</td>
                        <td className="py-2 pr-4 text-right tabular-nums text-gray-100">
                          {p.is_auxiliary ? '—' : (p.rounds_per_year ?? '—')}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-gray-400">
                          {p.measured_typical == null ? '—' : (
                            <>
                              {p.measured_typical}
                              {p.measured_min != null && p.measured_max != null && p.measured_min !== p.measured_max && (
                                <span className="ml-1 text-xs text-gray-600">({p.measured_min}–{p.measured_max})</span>
                              )}
                            </>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-gray-400">{p.live_jobs}</td>
                        <td className="py-2 pr-4 text-right whitespace-nowrap">
                          <button onClick={() => startEdit(p)} className="text-xs text-indigo-300 hover:text-indigo-200">Edit</button>
                          <button onClick={() => remove(p)} className="ml-3 text-xs text-red-300 hover:text-red-200">Remove</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {editing === null ? (
        <button onClick={() => startAdd()} className="mt-6 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-[#fff] hover:opacity-90">
          + Add a program
        </button>
      ) : (
        <div className="mt-6 rounded-lg border border-gray-800 bg-gray-950/60 p-4">
          <h3 className="text-sm font-semibold text-white">
            {editing === 'new' ? 'Add a program' : 'Edit program'}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <label className={lbl}>Jobber line item</label>
              <input className={input} value={lineItem} onChange={e => setLineItem(e.target.value)}
                     placeholder="WF - Lawn Health Basic" />
              <p className="mt-1 text-xs text-gray-600">Must match the line item name in Jobber exactly.</p>
            </div>
            <div>
              <label className={lbl}>Show it as</label>
              <input className={input} value={name} onChange={e => setName(e.target.value)} placeholder="Lawn Health Basic" />
            </div>
            <div>
              <label className={lbl}>Service line</label>
              <input className={input} value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="WF" list="rp-lines" />
              <datalist id="rp-lines">{lines.map(l => <option key={l} value={l} />)}</datalist>
            </div>
            <div>
              <label className={lbl}>{isAddOn ? 'Rounds/yr' : 'Charged per year'}</label>
              <input className={input} value={rounds} onChange={e => setRounds(e.target.value)}
                     disabled={isAddOn} placeholder={isAddOn ? 'follows base' : '8'} inputMode="numeric" />
            </div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={isAddOn} onChange={e => setIsAddOn(e.target.checked)} />
            This is an add-on, not a program of its own
          </label>
          <p className="mt-1 max-w-2xl text-xs text-gray-600">
            An add-on rides whatever program it sits beside and is charged on the same schedule, so it
            takes no number of its own. Plant Health Care and Bed Weed Prevention work this way.
          </p>
          <div className="mt-4 flex gap-2">
            <button onClick={save} disabled={saving}
                    className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-[#fff] hover:opacity-90 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditing(null)} className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800">
              Cancel
            </button>
          </div>
        </div>
      )}

      {unmapped.length > 0 && (
        <div className="mt-10 border-t border-gray-800 pt-6">
          <button onClick={() => setShowUnmapped(v => !v)} className="text-sm font-semibold text-gray-300 hover:text-white">
            {showUnmapped ? '▾' : '▸'} {unmapped.length} line item{unmapped.length === 1 ? '' : 's'} on recurring jobs that are not counted
          </button>
          <p className="mt-2 max-w-3xl text-sm text-gray-400">
            These sit on recurring jobs but are not part of the book.
            <span className="font-semibold text-amber-300"> Most of them belong here.</span> Repair
            parts and one-off work — spray heads, nozzles, a replaced controller — happen to be billed
            on a job that recurs, but they are not a yearly charge. Counting them would multiply the
            book by whatever cadence they inherited. Only add one if the customer really is charged
            for it on a repeating schedule.
          </p>
          {showUnmapped && (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-[11px] uppercase tracking-wider text-gray-500">
                    <th className="py-2 pr-4">Jobber line item</th>
                    <th className="py-2 pr-4 text-right">Jobs</th>
                    <th className="py-2 pr-4 text-right">Per visit</th>
                    <th className="py-2 pr-4">&nbsp;</th>
                  </tr>
                </thead>
                <tbody>
                  {unmapped.map(u => (
                    <tr key={u.line_item_name} className="border-b border-gray-900">
                      <td className="py-2 pr-4 font-mono text-xs text-gray-300">{u.line_item_name}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-gray-400">{u.live_jobs}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-gray-400">{money(u.per_visit_total)}</td>
                      <td className="py-2 pr-4 text-right">
                        <button onClick={() => startAdd(u)} className="text-xs text-indigo-300 hover:text-indigo-200">
                          Add as a program
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
