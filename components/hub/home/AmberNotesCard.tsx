'use client'

import { useCallback, useEffect, useState } from 'react'

// Amber's "Right Now" card — where temporary instructions get typed.
//
// Ben, Aug 24 2026: *"it would be nice if there was an easy spot where i can give Amber
// the AI receptionist temporary instructions without having to go into the knowledge
// base"*, and then, ruling out the obvious home for it: *"no I do not want to have to go
// into admin ai receptionist to type the note."* So it lives on Hub Home, next to
// Announcements — which it deliberately resembles, because "a short line of text that
// expires on a date" is a shape this Hub already has.
//
// The card is both the input AND the list of what is currently in force. There is no
// second screen: a note you cannot see is a note you forget you set, and these change
// how the phone answers.

type Note = {
  id: string
  kind: 'text' | 'booking_cap' | 'coverage'
  body: string
  cap_date: string | null
  cap_service: string | null
  cap_max_jobs: number | null
  out_user_id: string | null
  cover_user_id: string | null
  expires_at: string | null
  cancelled_at: string | null
  created_at: string
}

type Person = { id: string; name: string }
type Payload = { live: Note[]; recent: Note[]; services: string[]; people: Person[] }

type Draft = null | 'text' | 'booking_cap' | 'coverage'

const CHIPS: { value: string; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'date', label: 'Pick a date' },
  { value: 'never', label: 'Until I remove it' },
]

const KIND_STYLE: Record<Note['kind'], { dot: string; label: string }> = {
  text: { dot: 'bg-sky-400', label: 'Instruction' },
  booking_cap: { dot: 'bg-amber-400', label: 'Booking limit' },
  coverage: { dot: 'bg-violet-400', label: 'Coverage' },
}

/** Mirrors the phrasing the server puts in Amber's prompt, so the card and the
 *  receptionist describe a note's lifetime the same way. */
function expiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return 'until you remove it'
  const end = new Date(expiresAt)
  if (Number.isNaN(end.getTime())) return 'until you remove it'
  const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d)
  const time = (d: Date) =>
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(d)
  const now = new Date()
  if (ymd(end) === ymd(now)) return `through ${time(end)} today`
  if (ymd(end) === ymd(new Date(now.getTime() + 86400000))) return 'through tomorrow'
  return `through ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'short', day: 'numeric' }).format(end)}`
}

function todayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

export default function AmberNotesCard() {
  const [data, setData] = useState<Payload | null>(null)
  const [draft, setDraft] = useState<Draft>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // form state
  const [text, setText] = useState('')
  const [expires, setExpires] = useState('today')
  const [expiresDate, setExpiresDate] = useState(todayYmd())
  const [capDate, setCapDate] = useState(todayYmd())
  const [capService, setCapService] = useState('')
  const [capMax, setCapMax] = useState('0')
  const [outUser, setOutUser] = useState('')
  const [coverUser, setCoverUser] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/hub/voice-notes')
      if (!res.ok) return
      setData((await res.json()) as Payload)
    } catch {
      // leave the card as-is; a failed refresh must not blank out what's on screen
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function resetForm() {
    setDraft(null)
    setError('')
    setText('')
    setExpires('today')
    setExpiresDate(todayYmd())
    setCapDate(todayYmd())
    setCapService('')
    setCapMax('0')
    setOutUser('')
    setCoverUser('')
  }

  async function save(payload: Record<string, unknown>) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/hub/voice-notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(json.error || "Couldn't save that.")
        return
      }
      resetForm()
      await load()
    } catch {
      setError("Couldn't save that.")
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    try {
      await fetch(`/api/hub/voice-notes?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null

  const live = data.live
  // "All services" can only close a day — a positive number has to name one, because the
  // cap is counted per service. Mirrors the same rule enforced in the API.
  const capIsClosure = !capService

  return (
    <section className="mb-8">
      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-white/40">
              ☎️ Amber — right now
            </h2>
            <p className="mt-1 text-sm text-gray-400">
              {live.length === 0
                ? 'Running on her standard instructions.'
                : `${live.length} ${live.length === 1 ? 'instruction' : 'instructions'} in effect — these override her knowledge base.`}
            </p>
          </div>
        </div>

        {live.length > 0 && (
          <ul className="mt-4 space-y-2">
            {live.map((n) => (
              <li
                key={n.id}
                className="flex items-start gap-3 rounded-xl border border-gray-800 bg-gray-950/60 p-3"
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KIND_STYLE[n.kind].dot}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white">{n.body}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {KIND_STYLE[n.kind].label} · {expiryLabel(n.expires_at)}
                  </p>
                </div>
                <button
                  onClick={() => void remove(n.id)}
                  disabled={busy}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-800 hover:text-gray-200 disabled:opacity-40"
                  aria-label="Remove this instruction"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {draft === null && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => setDraft('text')}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:border-gray-500 hover:bg-gray-800"
            >
              + Tell her something
            </button>
            <button
              onClick={() => setDraft('booking_cap')}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:border-gray-500 hover:bg-gray-800"
            >
              + Booking limit
            </button>
            <button
              onClick={() => setDraft('coverage')}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:border-gray-500 hover:bg-gray-800"
            >
              + Someone&apos;s out
            </button>
          </div>
        )}

        {draft !== null && (
          <div className="mt-4 rounded-xl border border-gray-700 bg-gray-950/60 p-4">
            {draft === 'text' && (
              <>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Tell Amber
                </label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={2}
                  maxLength={500}
                  autoFocus
                  placeholder="e.g. We're closed Thursday for the holiday — don't promise anyone a Thursday visit."
                  className="mt-2 w-full resize-y rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-gray-500 focus:outline-none"
                />
                <ExpiryChips value={expires} onChange={setExpires} date={expiresDate} onDate={setExpiresDate} />
              </>
            )}

            {draft === 'booking_cap' && (
              <>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Booking limit
                </label>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  <div>
                    <span className="text-xs text-gray-500">Day</span>
                    <input
                      type="date"
                      value={capDate}
                      onChange={(e) => setCapDate(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-gray-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Service</span>
                    <select
                      value={capService}
                      onChange={(e) => {
                        setCapService(e.target.value)
                        if (!e.target.value) setCapMax('0')
                      }}
                      className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-gray-500 focus:outline-none"
                    >
                      <option value="">All services</option>
                      {data.services.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">How many</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={capIsClosure ? 0 : capMax}
                      disabled={capIsClosure}
                      onChange={(e) => setCapMax(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-gray-500 focus:outline-none disabled:opacity-50"
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {capIsClosure
                    ? 'Closes that day to new bookings. She’ll still offer a later day.'
                    : `She won’t book more than this many ${capService} jobs that day.`}
                </p>
                <p className="mt-1 text-xs text-gray-600">Expires on its own at the end of that day.</p>
              </>
            )}

            {draft === 'coverage' && (
              <>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Someone&apos;s out
                </label>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div>
                    <span className="text-xs text-gray-500">Who&apos;s out</span>
                    <select
                      value={outUser}
                      onChange={(e) => setOutUser(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-gray-500 focus:outline-none"
                    >
                      <option value="">Choose…</option>
                      {data.people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Send their calls to</span>
                    <select
                      value={coverUser}
                      onChange={(e) => setCoverUser(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-gray-500 focus:outline-none"
                    >
                      <option value="">Choose…</option>
                      {data.people
                        .filter((p) => p.id !== outUser)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
                <ExpiryChips value={expires} onChange={setExpires} date={expiresDate} onDate={setExpiresDate} />
              </>
            )}

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

            <div className="mt-4 flex gap-2">
              <button
                disabled={busy}
                onClick={() => {
                  if (draft === 'text') {
                    void save({ kind: 'text', body: text, expires, expires_date: expiresDate })
                  } else if (draft === 'booking_cap') {
                    void save({
                      kind: 'booking_cap',
                      cap_date: capDate,
                      cap_service: capService || null,
                      cap_max_jobs: capIsClosure ? 0 : Number(capMax),
                    })
                  } else {
                    void save({
                      kind: 'coverage',
                      out_user_id: outUser,
                      cover_user_id: coverUser,
                      expires,
                      expires_date: expiresDate,
                    })
                  }
                }}
                className="rounded-lg bg-white px-4 py-1.5 text-sm font-semibold text-gray-900 hover:bg-gray-200 disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Tell Amber'}
              </button>
              <button
                onClick={resetForm}
                disabled={busy}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {draft === null && data.recent.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300">
              Recently used ({data.recent.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {data.recent.map((n) => (
                <li key={n.id} className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="min-w-0 flex-1 truncate">{n.body}</span>
                  {/* Re-add is only offered for the kinds that mean the same thing on a
                      different day. A booking limit is welded to its date, so re-adding
                      it would silently recreate a note for a day already gone. */}
                  {n.kind !== 'booking_cap' && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void save(
                          n.kind === 'text'
                            ? { kind: 'text', body: n.body, expires: 'today' }
                            : {
                                kind: 'coverage',
                                out_user_id: n.out_user_id,
                                cover_user_id: n.cover_user_id,
                                expires: 'today',
                              },
                        )
                      }
                      className="shrink-0 rounded px-2 py-0.5 text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-40"
                    >
                      Use again today
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}

        <p className="mt-3 text-xs text-gray-600">
          Takes effect on her next call. A call already in progress finishes on the old instructions.
        </p>
      </div>
    </section>
  )
}

function ExpiryChips({
  value,
  onChange,
  date,
  onDate,
}: {
  value: string
  onChange: (v: string) => void
  date: string
  onDate: (v: string) => void
}) {
  return (
    <div className="mt-3">
      <span className="text-xs text-gray-500">Expires</span>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {CHIPS.map((c) => (
          <button
            key={c.value}
            onClick={() => onChange(c.value)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              value === c.value
                ? 'border-white bg-white text-gray-900'
                : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      {value === 'date' && (
        <input
          type="date"
          value={date}
          onChange={(e) => onDate(e.target.value)}
          className="mt-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-gray-500 focus:outline-none"
        />
      )}
    </div>
  )
}
