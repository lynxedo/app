'use client'

import { useMemo, useState } from 'react'
import type { WidgetCatalogEntry } from '@/lib/scoreboards/widgets/registry'

/* The widget picker, grouped the way the library is grouped.
 *
 * A widget that needs a source this tenant hasn't connected is shown and
 * explains what it needs, rather than being hidden — same principle as the
 * "Connect Jobber to unlock this" cards elsewhere (REPORTS_PRD.md §10). Hiding it
 * makes the library look smaller than it is and answers no questions.
 */

type Props = {
  catalog: WidgetCatalogEntry[]
  onAdd: (type: string) => void
  onClose: () => void
  /** Types already on the board — added, not blocked; duplicates are legitimate. */
  present: string[]
}

export function WidgetPicker({ catalog, onAdd, onClose, present }: Props) {
  const [query, setQuery] = useState('')

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
          {groups.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-500">Nothing matches “{query}”.</div>
          ) : null}

          {groups.map(([group, items]) => (
            <div key={group} className="mt-4">
              <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[1px] text-gray-500">{group}</h3>
              <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(228px,1fr))]">
                {items.map(w => {
                  const blocked = !!w.requires
                  return (
                    <button
                      key={w.type}
                      disabled={blocked}
                      onClick={() => !blocked && onAdd(w.type)}
                      className={`rounded-xl border border-sky-400/15 bg-white/[0.02] px-2.5 py-2 text-left ${blocked ? 'cursor-not-allowed opacity-50' : 'hover:border-sky-400/50 hover:bg-sky-400/[0.07]'}`}
                    >
                      <div className="text-[12px] font-semibold text-gray-200">{w.title}</div>
                      <div className="mt-0.5 text-[10.5px] text-gray-500">{w.blurb}</div>
                      {w.requires ? (
                        <span className="mt-1 inline-block rounded border border-amber-400/40 px-1 text-[9.5px] uppercase tracking-wide text-amber-400">
                          needs {w.requires}
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
