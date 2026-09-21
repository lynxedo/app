'use client'

// "Share to Hub" — the screen something shared from another app lands on.
//
// ⚠ The shared text arrives in sessionStorage, not the URL, and is cleared the
// moment it is read. It is somebody's address or note; a query string would
// leave it in history and logs. See app/hub/share/page.tsx.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

const SHARE_KEY = 'lynxedo_share_text'

type Target = { id: string; name: string }

export default function ShareIntoHub({ rooms, dms }: { rooms: Target[]; dms: Target[] }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<{ kind: 'room' | 'dm'; id: string; name: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      const shared = sessionStorage.getItem(SHARE_KEY)
      if (shared) {
        setText(shared)
        // Read once. Leaving it behind would re-share it on the next visit.
        sessionStorage.removeItem(SHARE_KEY)
      }
    } catch {
      // Private mode or blocked storage. The composer just starts empty.
    }
  }, [])

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const keep = (t: Target) => !q || t.name.toLowerCase().includes(q)
    return { rooms: rooms.filter(keep), dms: dms.filter(keep) }
  }, [filter, rooms, dms])

  async function send() {
    if (!picked || !text.trim() || sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/hub/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(picked.kind === 'room' ? { room_id: picked.id } : { conversation_id: picked.id }),
          content: text.trim(),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(body?.error ?? 'That did not send.')
      }
      // Land them where it went, so the send is visible rather than asserted.
      router.push(picked.kind === 'room' ? `/hub/${picked.id}` : `/hub/pm/${picked.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not send.')
      setSending(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <h1 className="text-xl font-bold text-white">Share to Hub</h1>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Nothing was shared — you can type something here."
          className="w-full rounded-xl bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-white"
        />

        {error && (
          <div className="rounded-lg border border-red-700 bg-red-900/40 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find a room or person"
          className="w-full rounded-xl bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-white"
        />

        <div className="rounded-xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
          {matches.rooms.map((r) => (
            <Row key={r.id} label={`# ${r.name}`}
                 selected={picked?.kind === 'room' && picked.id === r.id}
                 onClick={() => setPicked({ kind: 'room', id: r.id, name: r.name })} />
          ))}
          {matches.dms.map((d) => (
            <Row key={d.id} label={d.name}
                 selected={picked?.kind === 'dm' && picked.id === d.id}
                 onClick={() => setPicked({ kind: 'dm', id: d.id, name: d.name })} />
          ))}
          {matches.rooms.length === 0 && matches.dms.length === 0 && (
            <div className="px-3 py-4 text-sm text-gray-500">Nothing matches that.</div>
          )}
        </div>

        <button
          onClick={send}
          disabled={!picked || !text.trim() || sending}
          className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:hover:bg-sky-500 text-white font-bold"
        >
          {sending ? 'Sending…' : picked ? `Send to ${picked.name}` : 'Pick where it goes'}
        </button>
      </div>
    </div>
  )
}

function Row({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-3 text-sm ${
        selected ? 'bg-sky-500/20 text-sky-200' : 'text-gray-300 hover:bg-gray-900'
      }`}
    >
      {label}
    </button>
  )
}
