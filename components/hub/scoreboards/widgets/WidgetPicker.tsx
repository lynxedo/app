'use client'

import { useMemo, useState } from 'react'
import type { WidgetCatalogEntry } from '@/lib/scoreboards/widgets/registry'
import { getReport } from '@/lib/reports/registry'

/* The widget picker, grouped the way the library is grouped.
 *
 * A widget that needs a source this tenant hasn't connected is shown and
 * explains what it needs, rather than being hidden — same principle as the
 * "Connect Jobber to unlock this" cards elsewhere (REPORTS_PRD.md §10). Hiding it
 * makes the library look smaller than it is and answers no questions.
 *
 * The same choice is made for a widget the person isn't ENTITLED to: on a custom
 * Scoreboard the library is bounded by which Reports you can read, and a widget
 * outside that is shown greyed with the report it needs. A widget's title is not
 * the sensitive part — the numbers are, and those are gated server-side — so
 * naming what to ask for beats a library that quietly shrinks per person.
 */

type Props = {
  catalog: WidgetCatalogEntry[]
  onAdd: (type: string) => void
  onClose: () => void
  /** Types already on the board — added, not blocked; duplicates are legitimate. */
  present: string[]
  /**
   * Report slugs this person may read. Undefined = don't gate at all, which is what
   * the preset boards want: Board 8's cards answer to its own per-board grant, and
   * applying the report gate there would revoke them from people who see it today.
   */
  allowedReports?: string[]
  viewerIsAdmin?: boolean
}

function reportLabel(slugs: string[]): string {
  const titles = slugs.map(s => getReport(s)?.title).filter(Boolean) as string[]
  if (!titles.length) return 'a report you don’t have'
  if (titles.length === 1) return titles[0]
  return `${titles[0]} or ${titles.length - 1} other${titles.length > 2 ? 's' : ''}`
}

export function WidgetPicker({ catalog, onAdd, onClose, present, allowedReports, viewerIsAdmin }: Props) {
  const [query, setQuery] = useState('')
  const gated = allowedReports !== undefined && !viewerIsAdmin
  const locked = (w: WidgetCatalogEntry) =>
    gated && !w.reports.some(r => (allowedReports ?? []).includes(r))

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (w: WidgetCatalogEntry) =>
      !q || w.title.toLowerCase().includes(q) || w.blurb.toLowerCase().includes(q) || w.group.toLowerCase().includes(q)
    const out = new Map<string, WidgetCatalogEntry[]>()
    for (const w of catalog) {
      if (!match(w)) continue
      const list = out.get(w.group) ?? []
      list.push(w)
      out.set(w.group, list)
    }
    return [...out.entries()]
  }, [catalog, query])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5" role="dialog" aria-label="Add a widget">
      <button className="absolute inset-0 cursor-default bg-[#020a12]/60" aria-label="Close" onClick={onClose} />
      <div className="relative flex max-h-[84vh] w-[min(780px,100%)] flex-col overflow-hidden rounded-2xl border border-sky-400/15 bg-gradient-to-b from-[var(--t-panel)] to-[var(--t-sidebar)]">
        <div className="flex items-center gap-3 border-b border-sky-400/15 px-4 py-3.5">
          <div className="flex-1">
            <h2 className="text-[14px] font-semibold text-sky-50">Add a widget</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">One library. Preset Reports and your own Scoreboards draw from the same set.</p>
          </div>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search…"
            aria-label="Search widgets"
            className="w-40 rounded-lg border border-sky-400/15 bg-[#020c16]/60 px-2.5 py-1.5 text-[12px] text-gray-200"
          />
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-6 w-6 place-items-center rounded-md border border-amber-400/35 text-[12px] text-amber-200 hover:bg-amber-500 hover:text-[#291a00]"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-4 pb-4 pt-1">
          {/* Nothing at all is available. Worth saying outright: with per-report
              grants being nothing-until-granted, somebody who has Scoreboards but
              no Reports gets a whole library greyed out, and a wall of grey cards
              reads as a broken screen rather than a permissions answer. */}
          {gated && catalog.length > 0 && catalog.every(locked) ? (
            <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/[0.08] p-4 text-[12px] leading-relaxed text-[#fde3af]">
              <strong className="block text-[13px] font-semibold text-amber-400">No cards available to you yet</strong>
              <span className="mt-1 block">
                Every card comes from one of the ready-made Reports, and you don’t have access to any of
                them yet. Ask an admin to grant you the reports you need in{' '}
                <strong className="text-amber-200">Admin → Reports</strong> — the matching cards appear
                here as soon as they do.
              </span>
            </div>
          ) : null}

          {groups.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-500">Nothing matches “{query}”.</div>
          ) : null}

          {groups.map(([group, items]) => (
            <div key={group} className="mt-4">
              <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[1px] text-gray-500">{group}</h3>
              <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(228px,1fr))]">
                {items.map(w => {
                  const noReport = locked(w)
                  const blocked = !!w.requires || noReport
                  return (
                    <button
                      key={w.type}
                      disabled={blocked}
                      onClick={() => !blocked && onAdd(w.type)}
                      title={noReport ? `You need the ${reportLabel(w.reports)} report to use this` : undefined}
                      className={`rounded-xl border border-sky-400/15 bg-white/[0.02] px-2.5 py-2 text-left ${blocked ? 'cursor-not-allowed opacity-50' : 'hover:border-sky-400/50 hover:bg-sky-400/[0.07]'}`}
                    >
                      <div className="text-[12px] font-semibold text-gray-200">{w.title}</div>
                      <div className="mt-0.5 text-[10.5px] text-gray-500">{w.blurb}</div>
                      {w.requires ? (
                        <span className="mt-1 inline-block rounded border border-amber-400/40 px-1 text-[9.5px] uppercase tracking-wide text-amber-400">
                          needs {w.requires}
                        </span>
                      ) : noReport ? (
                        <span className="mt-1 inline-block rounded border border-white/20 px-1 text-[9.5px] uppercase tracking-wide text-gray-400">
                          🔒 needs {reportLabel(w.reports)}
                        </span>
                      ) : present.includes(w.type) ? (
                        <span className="mt-1 inline-block rounded border border-green-400/40 px-1 text-[9.5px] uppercase tracking-wide text-green-400">
                          on this board
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
