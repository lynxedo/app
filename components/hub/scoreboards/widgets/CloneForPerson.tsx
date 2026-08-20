'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  CATALOG_BRIDGE, CATALOG_LABEL, RECORDED_PROMPT, RECORDED_SOURCE,
  type PersonCatalog,
} from '@/lib/scoreboards/person-catalogs'

/* Duplicate a scoreboard, pointed at somebody.
 *
 * ⚠⚠ THE POINT OF THIS PANEL. A board built for one person names them on every
 * card, in up to five different spellings, and a copy made for somebody else keeps
 * every one of them until each is changed by hand. A filter left on the old person
 * doesn't error and doesn't blank — it draws a plausible number about the wrong
 * human, and the window in which that goes unnoticed is exactly the window in which
 * the board gets shared. So the re-pointing happens at copy time, and what CANNOT
 * be re-pointed is said out loud here rather than left to be discovered.
 *
 * ⚠ Two of the five naming systems have no link to the roster (see
 * lib/scoreboards/person-map.ts). Those are asked once and remembered, never
 * guessed from a first name — guessing is how two colleagues who share one get
 * merged into a single number.
 */

type Plan = {
  source: {
    title: string
    people: { employeeId: string; label: string; cards: number }[]
    unrecognised: { catalog: PersonCatalog; value: string; cards: number }[]
    everyoneCards: number
    filteredCards: number
    cards: number
  }
  roster: { employeeId: string; label: string; isActive: boolean }[]
  repoint: {
    fromEmployeeId: string
    fromLabel: string
    toEmployeeId: string
    toLabel: string
    changed: { catalog: PersonCatalog; from: string; to: string; cards: number }[]
    blocked: Blocked[]
  } | null
}

type Blocked = { catalog: PersonCatalog; value: string; cards: number; reason: string }

type CatalogOption = { value: string; label: string }

const isRecordable = (c: PersonCatalog): c is 'jobber_people' | 'lead_salespeople' =>
  CATALOG_BRIDGE[c] === 'recorded'

const cardWord = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`

export function CloneForPerson({
  slug, dirty, busy, onDuplicated,
}: {
  slug: string
  /** Unsaved edits on the panel — the copy is taken from the SAVED board. */
  dirty: boolean
  busy: boolean
  onDuplicated: (slug: string, title: string) => void
}) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [forWhom, setForWhom] = useState('')
  const [cloning, setCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<{ slug: string; title: string; lines: string[] } | null>(null)

  const load = useCallback(async (target: string) => {
    setError(null)
    try {
      const qs = new URLSearchParams({ from: slug })
      if (target) qs.set('for', target)
      const resp = await fetch(`/api/hub/scoreboards/clone-plan?${qs.toString()}`)
      const body = await resp.json()
      if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`)
      setPlan(body as Plan)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [slug])

  useEffect(() => { void load('') }, [load])

  const pick = (id: string) => {
    setForWhom(id)
    setNote(null)
    void load(id)
  }

  const duplicate = async () => {
    setCloning(true)
    setError(null)
    try {
      const resp = await fetch('/api/hub/scoreboards/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloneFrom: slug, forEmployeeId: forWhom || undefined }),
      })
      const body = await resp.json()
      if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`)

      /* Stop and say so whenever the copy is not a clean one — cards left behind
       * because their type is gone, or filters left naming the old person. Going
       * straight to a board that is quietly wrong is how it gets shared before
       * anybody reads it. A clean copy navigates immediately. */
      const lines: string[] = []
      const skipped = Number(body.skipped ?? 0)
      if (skipped > 0) {
        lines.push(`${skipped} ${skipped === 1 ? 'card is' : 'cards are'} no longer in the widget library and could not be copied.`)
      }
      const blocked = (body.repointed?.blocked ?? []) as Blocked[]
      for (const b of blocked) {
        lines.push(`${CATALOG_LABEL[b.catalog]}: ${cardWord(b.cards)} still filtered to “${b.value}” — ${b.reason}.`)
      }
      if (lines.length) {
        setNote({ slug: body.slug as string, title: (body.title as string) || 'New scoreboard', lines })
        setCloning(false)
        return
      }
      onDuplicated(body.slug as string, (body.title as string) || 'New scoreboard')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setCloning(false)
    }
    // No `finally`: on the clean path the caller navigates away, and clearing the
    // spinner first makes the button look ready for a second click during the hop.
  }

  const about = plan?.source.people ?? []
  const mixed = about.length > 1
  const repoint = plan?.repoint ?? null

  return (
    <div className="mt-6 rounded-xl border border-sky-400/15 bg-white/[0.02] p-3">
      <div className="text-[12.5px] font-semibold text-gray-200">Duplicate this scoreboard</div>
      <div className="mt-0.5 text-[10.5px] leading-relaxed text-gray-500">
        Makes a new board with the same cards and the same settings on each one.
        Who it&apos;s shared with is <strong className="text-gray-400">not</strong> copied — the copy starts private to you.
      </div>

      {error ? (
        <div className="mt-2 rounded-lg border border-red-400/25 bg-red-500/[0.06] p-2 text-[11px] text-red-200">{error}</div>
      ) : null}

      {dirty ? (
        <div className="mt-1.5 text-[10.5px] text-amber-400">
          Save your changes first — the copy is made from the saved board.
        </div>
      ) : null}

      {about.length > 0 ? (
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Who is the copy for?</div>
          <p className="mt-1 text-[10.5px] leading-relaxed text-gray-500">
            {mixed ? (
              <>
                ⚠ This board&apos;s cards are filtered to <strong className="text-amber-300">more than one person</strong>:{' '}
                {about.map(p => `${p.label} (${cardWord(p.cards)})`).join(', ')}. Only the busiest is re-pointed.
              </>
            ) : (
              <>
                Its cards are about <strong className="text-gray-300">{about[0].label}</strong> ({cardWord(about[0].cards)}).
                Pick who the copy is for and every filter that can be moved across will be.
              </>
            )}
          </p>
          <select
            value={forWhom}
            onChange={e => pick(e.target.value)}
            className="mt-2 w-full rounded-lg border border-sky-400/15 bg-[#020c16]/60 px-2.5 py-2 text-[12.5px] text-gray-200"
          >
            <option value="">Nobody in particular — copy it as it is</option>
            {(plan?.roster ?? []).map(r => (
              <option key={r.employeeId} value={r.employeeId}>
                {r.label}{r.isActive ? '' : ' (former)'}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {repoint ? (
        <div className="mt-3 space-y-2">
          {repoint.changed.length > 0 ? (
            <div className="rounded-lg border border-green-400/25 bg-green-500/[0.06] p-2 text-[10.5px] leading-relaxed text-green-200">
              <div className="font-semibold">
                Will re-point to {repoint.toLabel}
              </div>
              <ul className="mt-1 space-y-0.5">
                {repoint.changed.map(c => (
                  <li key={`${c.catalog}-${c.from}`}>
                    {CATALOG_LABEL[c.catalog]}: “{c.from}” → “{c.to}” ({cardWord(c.cards)})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {repoint.blocked.map(b => (
            <BlockedRow
              key={`${b.catalog}-${b.value}`}
              catalog={b.catalog}
              value={b.value}
              cards={b.cards}
              reason={b.reason}
              toEmployeeId={repoint.toEmployeeId}
              toLabel={repoint.toLabel}
              onRecorded={() => void load(forWhom)}
            />
          ))}

          {repoint.changed.length === 0 && repoint.blocked.length === 0 ? (
            <div className="rounded-lg border border-sky-400/20 bg-sky-500/[0.05] p-2 text-[10.5px] text-gray-400">
              Nothing to re-point — no card on this board names {repoint.fromLabel} in a way that can be moved.
            </div>
          ) : null}
        </div>
      ) : null}

      {about.length === 1 && (plan?.source.unrecognised.length ?? 0) > 0 ? (
        <div className="mt-3 space-y-2">
          {/* ⚠ The question that makes everything downstream work. These are names on
              the board you are copying FROM that can't be tied to anybody — almost
              always the Jobber or Lead Tracker spelling of the very person the board
              is about. Answering here means this copy can re-point them, AND that a
              leftover one on a future board is recognisable rather than invisible.
              It is asked, never assumed: the board being about Lucas is good evidence
              that its Jobber card is Lucas, but evidence is not the same as being
              told, and this is the file that must not start guessing at people. */}
          {plan!.source.unrecognised.map(u => (
            <PlaceName
              key={`${u.catalog}-${u.value}`}
              catalog={u.catalog}
              value={u.value}
              cards={u.cards}
              personId={about[0].employeeId}
              personLabel={about[0].label}
              onRecorded={() => void load(forWhom)}
            />
          ))}
        </div>
      ) : null}

      {plan && plan.source.everyoneCards > 0 ? (
        <p className="mt-2 text-[10.5px] leading-relaxed text-gray-500">
          ⚠ {cardWord(plan.source.everyoneCards)} on this board {plan.source.everyoneCards === 1 ? 'has' : 'have'} no
          person filter at all, so {plan.source.everyoneCards === 1 ? 'it shows' : 'they show'} the whole company.
          Copying doesn&apos;t change that — worth a look before you share it.
        </p>
      ) : null}

      {note ? (
        <div className="mt-2 rounded-lg border border-amber-400/35 bg-amber-500/[0.08] p-2 text-[10.5px] leading-relaxed text-[#fde3af]">
          <div className="font-semibold">The copy was made, but read this first:</div>
          <ul className="mt-1 space-y-0.5">
            {note.lines.map(l => <li key={l}>{l}</li>)}
          </ul>
          <button
            onClick={() => onDuplicated(note.slug, note.title)}
            className="mt-1.5 underline decoration-dotted hover:text-amber-200"
          >
            Open the copy
          </button>
        </div>
      ) : null}

      <div className="mt-3 flex justify-end">
        <button
          onClick={() => void duplicate()}
          disabled={busy || cloning || dirty}
          title={dirty ? 'Save your changes first' : 'Make a copy of this scoreboard'}
          className="rounded-lg border border-sky-400/30 px-3 py-1.5 text-[12px] text-sky-200 hover:border-sky-400/60 disabled:opacity-50"
        >
          {cloning ? 'Copying…' : forWhom ? '⧉ Duplicate for this person' : '⧉ Duplicate'}
        </button>
      </div>
    </div>
  )
}

/**
 * One filter that couldn't be moved across — and, when the reason is a missing
 * answer rather than missing data, the one question that fixes it for good.
 */
function BlockedRow({
  catalog, value, cards, reason, toEmployeeId, toLabel, onRecorded,
}: {
  catalog: PersonCatalog
  value: string
  cards: number
  reason: string
  toEmployeeId: string
  toLabel: string
  onRecorded: () => void
}) {
  const [options, setOptions] = useState<CatalogOption[] | null>(null)
  const [choice, setChoice] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const recordable = isRecordable(catalog)

  useEffect(() => {
    if (!recordable) return
    let live = true
    void (async () => {
      try {
        const resp = await fetch(`/api/hub/scoreboards/catalogs?name=${encodeURIComponent(catalog)}`)
        const body = await resp.json()
        if (live && resp.ok) setOptions((body.options ?? []) as CatalogOption[])
      } catch { /* the row still explains itself without the picker */ }
    })()
    return () => { live = false }
  }, [catalog, recordable])

  const record = async () => {
    if (!choice) return
    setSaving(true)
    setErr(null)
    try {
      const resp = await fetch('/api/hub/scoreboards/clone-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: toEmployeeId, kind: catalog, value: choice }),
      })
      const body = await resp.json()
      if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`)
      onRecorded()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-amber-400/30 bg-amber-500/[0.06] p-2 text-[10.5px] leading-relaxed text-[#fde3af]">
      <div>
        <strong>{CATALOG_LABEL[catalog]}</strong>: {cardWord(cards)} would stay filtered to “{value}” — {reason}.
      </div>

      {recordable ? (
        <div className="mt-1.5">
          <div className="text-gray-400">
            {RECORDED_PROMPT[catalog]} Tell me once and every board you copy for {toLabel} from now on will know.
          </div>
          <div className="mt-1 flex gap-1.5">
            <select
              value={choice}
              onChange={e => setChoice(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-sky-400/15 bg-[#020c16]/60 px-2 py-1.5 text-[11.5px] text-gray-200"
            >
              <option value="">{options === null ? 'Loading…' : `${toLabel} in ${RECORDED_SOURCE[catalog]}…`}</option>
              {(options ?? []).map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={() => void record()}
              disabled={!choice || saving}
              className="shrink-0 rounded-md border border-sky-400/30 px-2.5 py-1.5 text-[11.5px] text-sky-200 hover:border-sky-400/60 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Remember'}
            </button>
          </div>
          {err ? <div className="mt-1 text-red-300">{err}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * "This board is about Lucas — and it has cards filtered to a name I can't place.
 * Is that him?"
 *
 * ⚠ Separate from `BlockedRow` on purpose. That one asks about the person the copy
 * is FOR; this asks about the person the board is already about, which is what
 * teaches the system the spelling it was missing. Both write the same recorded
 * mapping, and neither ever fills it in without being told.
 */
function PlaceName({
  catalog, value, cards, personId, personLabel, onRecorded,
}: {
  catalog: PersonCatalog
  value: string
  cards: number
  personId: string
  personLabel: string
  onRecorded: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  if (!isRecordable(catalog)) return null

  const record = async () => {
    setSaving(true)
    setErr(null)
    try {
      const resp = await fetch('/api/hub/scoreboards/clone-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: personId, kind: catalog, value }),
      })
      const body = await resp.json()
      if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`)
      setDone(true)
      onRecorded()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (done) return null

  return (
    <div className="rounded-lg border border-sky-400/20 bg-sky-500/[0.05] p-2 text-[10.5px] leading-relaxed text-gray-400">
      <div>
        <strong className="text-gray-300">{CATALOG_LABEL[catalog]}</strong>: {cardWord(cards)} here {cards === 1 ? 'is' : 'are'} filtered
        to “{value}”, and I can&apos;t tell who that is. Is it <strong className="text-gray-300">{personLabel}</strong>?
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <button
          onClick={() => void record()}
          disabled={saving}
          className="rounded-md border border-sky-400/30 px-2.5 py-1 text-[11.5px] text-sky-200 hover:border-sky-400/60 disabled:opacity-50"
        >
          {saving ? 'Saving…' : `Yes — that's ${personLabel}`}
        </button>
        <span className="text-gray-600">Saying yes lets this copy move those cards across too.</span>
      </div>
      {err ? <div className="mt-1 text-red-300">{err}</div> : null}
    </div>
  )
}
