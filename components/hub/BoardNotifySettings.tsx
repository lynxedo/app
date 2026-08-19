'use client'

/**
 * "Notify me" — one person's own notification settings for one board.
 *
 * Lives on the board itself (the 🔔 in the board header), not in Settings and
 * not in Admin: every person on a board picks their own, and nobody's choice
 * changes what anybody else receives.
 *
 * Choices save the moment they're tapped (no Save button) and are applied
 * optimistically, rolling back if the write fails.
 */

import { useCallback, useRef, useState } from 'react'
import { useOutsideClose } from '@/hooks/use-outside-close'
import { useToast, Spinner } from '@/components/ui'

type Level = 'all' | 'mine' | 'off'
type Kind = 'new_tasks' | 'replies' | 'files' | 'due'
type Prefs = Record<Kind, Level>

const DEFAULTS: Prefs = { new_tasks: 'all', replies: 'off', files: 'off', due: 'mine' }

const ROWS: { kind: Kind; label: string; hint: string; allLabel: string; mineLabel: string }[] = [
  {
    kind: 'new_tasks',
    label: 'New tasks',
    hint: 'When someone adds a task to this board.',
    allLabel: 'Every task',
    mineLabel: 'Assigned to me',
  },
  {
    kind: 'replies',
    label: 'Replies',
    hint: 'When someone writes a note on a task.',
    allLabel: 'Every reply',
    mineLabel: "Tasks I'm on",
  },
  {
    kind: 'files',
    label: 'Files',
    hint: 'When someone attaches a file to a task.',
    allLabel: 'Every file',
    mineLabel: "Tasks I'm on",
  },
  {
    kind: 'due',
    label: 'Due & overdue',
    hint: 'A heads-up the morning a task is due, and again if it goes past its deadline.',
    allLabel: 'Every task',
    mineLabel: 'Assigned to me',
  },
]

export default function BoardNotifySettings({ boardId }: { boardId: string }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [loading, setLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])
  useOutsideClose(panelRef, open, close)

  // Loaded from the click that opens the panel, not from an effect — the board's
  // own load stays free of a request most people will never need, and there's no
  // render-cascade to reason about.
  function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (prefs || loading) return
    setLoading(true)
    fetch(`/api/hub/boards/${boardId}/notifications`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setPrefs(d?.prefs ?? { ...DEFAULTS }))
      .catch(() => setPrefs({ ...DEFAULTS }))
      .finally(() => setLoading(false))
  }

  async function set(kind: Kind, level: Level) {
    if (!prefs || prefs[kind] === level) return
    const previous = prefs
    const next = { ...prefs, [kind]: level }
    setPrefs(next) // optimistic — the panel should feel like a switch, not a form
    const res = await fetch(`/api/hub/boards/${boardId}/notifications`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => null)
    if (!res?.ok) {
      setPrefs(previous)
      toast.error('Couldn’t save that — try again.')
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        // Deliberately NOT stopPropagation: the click bubbles to BoardView's
        // root, whose closePopups() dismisses the board's own date/assign/repeat
        // pickers — two popovers open at once reads as broken.
        onClick={toggle}
        title="Notify me"
        aria-label="Notify me"
        aria-expanded={open}
        className={`p-2 rounded-lg transition-colors ${open ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      </button>

      {open && (
        <div
          onClick={e => e.stopPropagation()}
          className="absolute right-0 top-full mt-2 z-50 w-[19rem] max-w-[calc(100vw-2rem)] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-3"
        >
          <p className="text-sm font-semibold text-white">Notify me</p>
          <p className="text-[11px] text-white/40 mt-0.5">
            Just for you on this board — nobody else is affected.
          </p>

          {loading || !prefs ? (
            <div className="py-6 text-center"><Spinner size={5} /></div>
          ) : (
            <div className="mt-3 space-y-3">
              {ROWS.map(row => (
                <div key={row.kind}>
                  <p className="text-xs font-medium text-white/80">{row.label}</p>
                  <div className="mt-1 flex bg-white/5 rounded-lg p-0.5 gap-0.5">
                    {([
                      ['all', row.allLabel],
                      ['mine', row.mineLabel],
                      ['off', 'Off'],
                    ] as [Level, string][]).map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => set(row.kind, value)}
                        className={`flex-1 px-1.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                          prefs[row.kind] === value
                            ? 'bg-brand text-[#fff]'
                            : 'text-white/50 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-white/30 mt-1">{row.hint}</p>
                </div>
              ))}

              <p className="text-[11px] text-white/40 border-t border-white/10 pt-2">
                You&rsquo;re always told when someone <strong className="text-white/60">@mentions</strong> you here,
                whatever you pick above.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
