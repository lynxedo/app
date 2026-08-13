'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/* "+ New scoreboard" — creates an empty board and opens it.
 *
 * Deliberately asks for nothing but a name. The board arrives empty and the person
 * fills it from the widget picker, which is where the library (and the report-based
 * limit on it) already lives; a create-then-configure wizard would be a second
 * place to maintain the same choices.
 */

export default function NewScoreboardButton({
  compact, onCreated,
}: {
  compact?: boolean
  /**
   * Where to go once it exists. Omitted → navigate. The Workspace-Tabs index passes
   * a handler that opens the new board as its own tab instead, because a push from
   * inside a kept-alive tab renders the route in the tab area with no tab of its
   * own — the board would open, unnamed and unclosable.
   */
  onCreated?: (slug: string, title: string) => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const resp = await fetch('/api/hub/scoreboards/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      const body = await resp.json()
      if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`)
      const name = title.trim() || 'New scoreboard'
      if (onCreated) { setOpen(false); setBusy(false); setTitle(''); onCreated(body.slug, name) }
      else router.push(`/hub/scoreboards/${body.slug}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={compact
          ? 'rounded-lg border border-sky-400/30 px-2.5 py-1.5 text-[12px] text-sky-200 hover:border-sky-400/60'
          : 'rounded-lg bg-sky-500 px-3.5 py-2 text-[13px] font-semibold text-[#fff] hover:brightness-110'}
      >
        ＋ New scoreboard
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-5" role="dialog" aria-label="New scoreboard">
          <button className="absolute inset-0 cursor-default bg-[#020a12]/60" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="relative w-[min(420px,100%)] rounded-2xl border border-sky-400/15 bg-gradient-to-b from-[var(--t-panel)] to-[var(--t-sidebar)] p-4">
            <h2 className="text-[14px] font-semibold text-sky-50">New scoreboard</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Give it a name. You’ll pick the cards next, and choose who can see it when you’re ready.
            </p>
            <input
              autoFocus
              value={title}
              maxLength={80}
              placeholder="e.g. Monday morning numbers"
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !busy) void create() }}
              className="mt-3 w-full rounded-lg border border-sky-400/15 bg-[#020c16]/60 px-2.5 py-2 text-[13px] text-gray-200"
            />
            {error ? <p className="mt-2 text-[11.5px] text-red-300">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-sky-400/15 px-3 py-1.5 text-[12px] text-gray-400">
                Cancel
              </button>
              <button
                onClick={() => void create()}
                disabled={busy}
                className="rounded-lg bg-sky-500 px-3 py-1.5 text-[12px] font-semibold text-[#fff] hover:brightness-110 disabled:opacity-60"
              >
                {busy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
