'use client'

import { useEffect, useState } from 'react'

/* "This board is about more than one person."
 *
 * ⚠⚠ WHY THIS EXISTS. A board built for one person is usually made by copying the
 * last one, and every person filter on it has to be re-pointed. The duplicate
 * dialog now does that automatically wherever it can — but two of the five ways a
 * person is named have no link to the roster and can be left behind, and a filter
 * changed by hand in the editor can be missed just as easily. A leftover filter
 * doesn't error and doesn't blank; it draws a confident number about the wrong
 * human. This is the one thing on the screen that notices.
 *
 * ⚠ Shown ONLY to whoever can manage the board. A viewer can't fix it, and the
 * board already shows them the figures either way — so to them it would be noise
 * about somebody else's housekeeping.
 *
 * ⚠ Fetched separately rather than folded into the board payload, deliberately: it
 * needs an all-time read of the crew and people figures to tie names to the roster,
 * and that has no business sitting on the critical path of every board load. It
 * arrives a moment late, which is the right trade for a warning.
 */

type Analysis = {
  source: {
    people: { employeeId: string; label: string; cards: number }[]
    unrecognised: { catalog: string; value: string; cards: number }[]
  }
}

const cardWord = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`

export function MixedPeopleBanner({ slug, canManage }: { slug: string; canManage: boolean }) {
  const [seen, setSeen] = useState<Analysis['source'] | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!canManage) return
    let live = true
    void (async () => {
      try {
        const resp = await fetch(`/api/hub/scoreboards/clone-plan?from=${encodeURIComponent(slug)}`)
        if (!resp.ok) return
        const body = await resp.json() as Analysis
        if (live) setSeen(body.source)
      } catch { /* a warning that fails to load must not break the board */ }
    })()
    return () => { live = false }
  }, [slug, canManage])

  if (!canManage || hidden || !seen) return null

  const people = seen.people ?? []
  const strays = seen.unrecognised ?? []

  /* ⚠⚠ TWO OR MORE RECOGNISED PEOPLE — and deliberately NOT "or there are names I
   * can't place".
   *
   * The tempting version also fires on unplaceable names, on the reasoning that a
   * leftover Jobber card is exactly what a copy leaves behind. It was written that
   * way first and it was wrong: a correctly-built board carries unplaceable names
   * all the time, because a Jobber user has no link to the roster until somebody
   * records one. Lucas's own board would have opened with an amber warning about
   * Lucas. A warning that fires on correct boards is one people learn to dismiss,
   * and then it isn't there on the day it matters.
   *
   * The leftover case is still caught, just later in the chain: the duplicate
   * dialog says out loud which filters it could not move, and it offers to record
   * the names it can't place. Once recorded, those values resolve to a person — so
   * a leftover Lucas card on Angel's board becomes a second RECOGNISED person and
   * lands here. The check gets sharper as the answers accumulate, rather than
   * shouting on day one. */
  if (people.length < 2) return null

  return (
    <div className="flex flex-wrap items-start gap-2.5 border-b border-amber-400/30 bg-amber-500/[0.10] px-5 py-2.5 text-[11.5px] leading-relaxed text-[#fde3af]">
      <span className="font-semibold text-amber-400">Filtered to more than one person.</span>
      <span className="min-w-0 flex-1">
        {people.map(p => `${p.label} (${cardWord(p.cards)})`).join(', ')}
        {strays.length ? (
          <>
            {'; and '}
            {strays.map(s => `${cardWord(s.cards)} filtered to “${s.value}”, which I can’t place`).join('; ')}
          </>
        ) : null}
        . If this board is meant to be about one person, the odd ones out are usually left over from a copy —
        open <strong className="text-amber-200">✎ Edit board</strong> and check each card&apos;s people setting.
      </span>
      <button
        onClick={() => setHidden(true)}
        className="shrink-0 rounded-md border border-amber-400/35 px-2 py-0.5 text-[11px] text-amber-200 hover:bg-amber-500/15"
      >
        Dismiss
      </button>
    </div>
  )
}
