'use client'

import { useEffect, useState } from 'react'
import { formatPhone } from '@/lib/format'

type Candidate = { id: string; name: string; phone: string | null; email: string | null }

// Manual merge: fold this contact (the one being viewed) INTO another contact
// that survives. Used for the cross-key duplicate a phone/email match can't
// auto-merge (CRM_CONTACTS_PRD §7).
export default function MergeContactModal({
  sourceId,
  sourceName,
  onClose,
  onMerged,
}: {
  sourceId: string
  sourceName: string
  onClose: () => void
  onMerged: (winnerId: string) => void
}) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(false)
  const [target, setTarget] = useState<Candidate | null>(null)
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState('')

  // Debounced search for the survivor. Skip while a target is chosen (confirm step).
  useEffect(() => {
    if (target) return
    const q = search.trim()
    if (q.length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ search: q, include_do_not_text: '1', limit: '20' })
        const res = await fetch(`/api/contacts?${params.toString()}`)
        if (res.ok) {
          const data = await res.json()
          setResults((data.contacts ?? []).filter((c: Candidate) => c.id !== sourceId))
        }
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [search, sourceId, target])

  async function confirmMerge() {
    if (!target || merging) return
    setError('')
    setMerging(true)
    try {
      const res = await fetch(`/api/contacts/${sourceId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ into: target.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Merge failed'); setMerging(false); return }
      onMerged(target.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
      setMerging(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4">
      <div className="bg-[var(--t-panel)] border border-white/10 rounded-lg w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-medium">Merge contact</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Close">×</button>
        </div>

        {!target ? (
          <div className="p-4 space-y-3 overflow-y-auto">
            <p className="text-xs text-white/50">
              Search for the contact that <span className="text-white/80">{sourceName}</span> should be merged into.
              That contact will survive and keep all the history.
            </p>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, phone or email…"
              className="w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
              style={{ fontSize: 16 }}
              autoFocus
            />
            <div className="min-h-[3rem]">
              {loading && <div className="text-xs text-white/40 px-1 py-2">Searching…</div>}
              {!loading && search.trim().length >= 2 && results.length === 0 && (
                <div className="text-xs text-white/40 px-1 py-2">No matches.</div>
              )}
              <ul className="divide-y divide-white/5">
                {results.map(c => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setTarget(c)}
                      className="w-full text-left px-2 py-2 rounded hover:bg-white/5"
                    >
                      <div className="text-sm font-medium truncate">{c.name}</div>
                      <div className="text-[11px] text-white/40 truncate">
                        {c.phone ? formatPhone(c.phone) : c.email || '—'}
                        {c.phone && c.email && <span className="text-white/25"> · {c.email}</span>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-3 overflow-y-auto">
            <p className="text-sm">
              Merge <span className="font-medium text-orange-300">{sourceName}</span> into{' '}
              <span className="font-medium text-emerald-300">{target.name}</span>?
            </p>
            <p className="text-xs text-white/50">
              All texts, calls, voicemails, emails, tags, and notes from {sourceName} move to {target.name}.
              Any blank fields on {target.name} are filled in from {sourceName}; existing values are kept.
              {sourceName} is then removed from the directory. This can’t be undone from the app.
            </p>
            {error && <div className="text-xs text-red-400">{error}</div>}
          </div>
        )}

        <div className="px-4 py-3 border-t border-white/10 flex justify-between gap-2">
          {target ? (
            <button
              onClick={() => { setTarget(null); setError('') }}
              disabled={merging}
              className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-sm disabled:opacity-50"
            >
              ← Back
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} disabled={merging} className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-sm disabled:opacity-50">Cancel</button>
            {target && (
              <button
                onClick={confirmMerge}
                disabled={merging}
                className="px-3 py-1.5 rounded-md bg-orange-600 hover:bg-orange-500 text-sm font-medium disabled:opacity-50"
              >
                {merging ? 'Merging…' : 'Merge'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
