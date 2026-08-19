'use client'

import { useCallback, useEffect, useState } from 'react'
import { getReport } from '@/lib/reports/registry'
import { useConfirm } from '@/components/ui'

/* Rename, share and delete a scoreboard somebody built.
 *
 * The share list is the point of the panel, and the per-person note under each
 * name is the reason it's worth a panel rather than a checkbox list: the widget
 * gate is applied to the VIEWER, so a card reading somebody's wages simply won't
 * render for a technician. Saying that here — "won't see 3 of these (needs Crew &
 * Labor)" — turns a board that looks broken on their screen into a choice made
 * with the facts.
 */

type AudienceMember = {
  id: string
  name: string
  canOpenScoreboards: boolean
  hiddenWidgetCount: number
  neededReports: string[]
}

type Detail = {
  board: { slug: string; title: string; sharedAll: boolean }
  viewers: string[]
  audience: AudienceMember[]
}

function neededLabel(slugs: string[]): string {
  const titles = slugs.map(s => getReport(s)?.title).filter(Boolean) as string[]
  if (!titles.length) return 'reports they don’t have'
  if (titles.length <= 2) return titles.join(' and ')
  return `${titles[0]} and ${titles.length - 1} others`
}

export function CustomBoardManager({
  slug, onClose, onRenamed, onDeleted, onDuplicated,
}: {
  slug: string
  onClose: () => void
  onRenamed: (title: string) => void
  onDeleted: () => void
  /**
   * Where to send them once the copy exists. REQUIRED, not optional: an optional
   * callback would let a future caller mount this panel with the duplicate button
   * quietly doing nothing, and a control that no-ops is worse than one that isn't
   * there. The two callers want different navigation, which is why it's a prop at
   * all — see each of them.
   */
  onDuplicated: (slug: string, title: string) => void
}) {
  const confirm = useConfirm()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [sharedAll, setSharedAll] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [cloning, setCloning] = useState(false)
  /** Set only when the copy left something behind, so it can be said out loud. */
  const [cloneNote, setCloneNote] = useState<{ slug: string; copied: number; skipped: number } | null>(null)
  /** Edits made here but not written yet. The copy is taken from the SAVED board,
   *  so this is what stops a duplicate quietly ignoring what's on screen. */
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const resp = await fetch(`/api/hub/scoreboards/custom/${encodeURIComponent(slug)}`)
      const body = await resp.json()
      if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`)
      const d = body as Detail
      setDetail(d)
      setTitle(d.board.title)
      setSharedAll(d.board.sharedAll)
      setPicked(new Set(d.viewers))
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [slug])

  useEffect(() => { void load() }, [load])

  const toggle = (id: string) => {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    setSaved(false)
    setDirty(true)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const resp = await fetch(`/api/hub/scoreboards/custom/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, sharedAll, userIds: [...picked] }),
      })
      const body = await resp.json()
      if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`)
      onRenamed(title.trim() || 'New scoreboard')
      setSaved(true)
      setDirty(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const duplicate = async () => {
    setCloning(true)
    setError(null)
    try {
      const resp = await fetch('/api/hub/scoreboards/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloneFrom: slug }),
      })
      const body = await resp.json()
      if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`)
      const skipped = Number(body.skipped ?? 0)
      if (skipped > 0) {
        // A card whose type has since been retired from the library can't be
        // copied. Rare, but going straight to a board that is quietly one card
        // short is how you find out weeks later and blame the wrong thing — so
        // stop here, say it, and let them go on deliberately.
        setCloneNote({ slug: body.slug as string, copied: Number(body.copied ?? 0), skipped })
        setCloning(false)
        return
      }
      onDuplicated(body.slug as string, (body.title as string) || 'New scoreboard')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setCloning(false)
    }
    // Deliberately no `finally`: on the ordinary success path the caller navigates
    // away, and clearing the spinner first makes the button look ready for a
    // second click during the hop — which would be a second copy.
  }

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this scoreboard?',
      message: `“${detail?.board.title ?? 'This scoreboard'}” and everything on it will be removed for everyone it was shared with. This cannot be undone.`,
      confirmText: 'Delete',
      danger: true,
    })
    if (!ok) return
    setSaving(true)
    try {
      const resp = await fetch(`/api/hub/scoreboards/custom/${encodeURIComponent(slug)}`, { method: 'DELETE' })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`)
      onDeleted()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5" role="dialog" aria-label="Scoreboard settings">
      <button className="absolute inset-0 cursor-default bg-[#020a12]/60" aria-label="Close" onClick={onClose} />
      <div className="relative flex max-h-[86vh] w-[min(560px,100%)] flex-col overflow-hidden rounded-2xl border border-sky-400/15 bg-gradient-to-b from-[var(--t-panel)] to-[var(--t-sidebar)]">
        <div className="flex items-center gap-3 border-b border-sky-400/15 px-4 py-3.5">
          <div className="flex-1">
            <h2 className="text-[14px] font-semibold text-sky-50">Scoreboard settings</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">Rename it, choose who can see it, or delete it.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-6 w-6 place-items-center rounded-md border border-amber-400/35 text-[12px] text-amber-200 hover:bg-amber-500 hover:text-[#291a00]"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4">
          {error ? (
            <div className="mb-3 rounded-lg border border-red-400/25 bg-red-500/[0.06] p-2.5 text-[11.5px] text-red-200">{error}</div>
          ) : null}

          {!detail ? (
            <div className="py-10 text-center text-[12px] text-gray-500">Loading…</div>
          ) : (
            <>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Name</label>
              <input
                value={title}
                maxLength={80}
                onChange={e => { setTitle(e.target.value); setSaved(false); setDirty(true) }}
                className="mt-1.5 w-full rounded-lg border border-sky-400/15 bg-[#020c16]/60 px-2.5 py-2 text-[13px] text-gray-200"
              />

              <div className="mt-5 flex items-baseline justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Who can see it</span>
                <span className="text-[10.5px] text-gray-600">You always can — you built it</span>
              </div>

              <label className="mt-2 flex cursor-pointer items-start gap-2.5 rounded-xl border border-sky-400/15 bg-white/[0.02] px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={sharedAll}
                  onChange={e => { setSharedAll(e.target.checked); setSaved(false); setDirty(true) }}
                  className="mt-0.5 h-4 w-4 accent-sky-400"
                />
                <span>
                  <span className="block text-[12.5px] font-semibold text-gray-200">Everyone who can open Scoreboards</span>
                  <span className="mt-0.5 block text-[10.5px] text-gray-500">
                    Keeps working as people join and leave — no re-sharing.
                  </span>
                </span>
              </label>

              <div className={`mt-3 space-y-1.5 ${sharedAll ? 'opacity-50' : ''}`}>
                {detail.audience.length === 0 ? (
                  <p className="py-3 text-[11.5px] text-gray-500">No teammates to share with yet.</p>
                ) : detail.audience.map(m => (
                  <label
                    key={m.id}
                    className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-sky-400/[0.12] px-2.5 py-2 hover:border-sky-400/35"
                  >
                    <input
                      type="checkbox"
                      disabled={sharedAll}
                      checked={sharedAll || picked.has(m.id)}
                      onChange={() => toggle(m.id)}
                      className="mt-0.5 h-4 w-4 accent-sky-400"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-gray-200">{m.name}</span>
                      {/* Two different "this won't work" cases, kept apart because the
                          fix differs: no Scoreboards access at all vs. no access to
                          the reports behind particular cards. */}
                      {!m.canOpenScoreboards ? (
                        <span className="mt-0.5 block text-[10.5px] text-amber-400">
                          Can’t open Scoreboards — an admin needs to grant that first
                        </span>
                      ) : m.hiddenWidgetCount > 0 ? (
                        <span className="mt-0.5 block text-[10.5px] text-gray-500">
                          Won’t see {m.hiddenWidgetCount} {m.hiddenWidgetCount === 1 ? 'card' : 'cards'} — needs {neededLabel(m.neededReports)}
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-[10.5px] text-green-400/70">Sees the whole board</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>

              <div className="mt-6 rounded-xl border border-sky-400/15 bg-white/[0.02] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold text-gray-200">Duplicate this scoreboard</div>
                    {/* The second sentence is the one that matters. Copying the cards
                        is what people expect; copying the audience is what they'd
                        assume happened too, and finding out otherwise weeks later —
                        or the reverse, sharing by accident — is the failure worth
                        one line of text here. */}
                    <div className="mt-0.5 text-[10.5px] leading-relaxed text-gray-500">
                      Makes a new board with the same cards and the same settings on each one.
                      Who it&apos;s shared with is <strong className="text-gray-400">not</strong> copied — the copy starts private to you.
                    </div>
                    {dirty ? (
                      <div className="mt-1.5 text-[10.5px] text-amber-400">
                        Save your changes first — the copy is made from the saved board.
                      </div>
                    ) : null}
                    {cloneNote ? (
                      <div className="mt-2 rounded-lg border border-amber-400/35 bg-amber-500/[0.08] p-2 text-[10.5px] leading-relaxed text-[#fde3af]">
                        Copied {cloneNote.copied} {cloneNote.copied === 1 ? 'card' : 'cards'}, but{' '}
                        {cloneNote.skipped} {cloneNote.skipped === 1 ? 'card is' : 'cards are'} no longer in the
                        widget library and could not be copied.{' '}
                        <button
                          onClick={() => onDuplicated(cloneNote.slug, title)}
                          className="underline decoration-dotted hover:text-amber-200"
                        >
                          Open the copy
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <button
                    onClick={() => void duplicate()}
                    disabled={saving || cloning || dirty}
                    title={dirty ? 'Save your changes first' : 'Make a copy of this scoreboard'}
                    className="shrink-0 rounded-lg border border-sky-400/30 px-3 py-1.5 text-[12px] text-sky-200 hover:border-sky-400/60 disabled:opacity-50"
                  >
                    {cloning ? 'Copying…' : '⧉ Duplicate'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-sky-400/15 px-4 py-3">
          <button
            onClick={() => void remove()}
            disabled={saving || cloning || !detail}
            className="rounded-lg border border-red-400/35 px-3 py-1.5 text-[12px] text-red-300 hover:bg-red-500/10 disabled:opacity-50"
          >
            Delete
          </button>
          <div className="flex-1" />
          {saved ? <span className="text-[11px] text-green-400">Saved</span> : null}
          <button onClick={onClose} className="rounded-lg border border-sky-400/15 px-3 py-1.5 text-[12px] text-gray-400">
            Close
          </button>
          <button
            onClick={() => void save()}
            disabled={saving || cloning || !detail}
            className="rounded-lg bg-sky-500 px-3 py-1.5 text-[12px] font-semibold text-[#fff] hover:brightness-110 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
