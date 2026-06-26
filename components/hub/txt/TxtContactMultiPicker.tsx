'use client'

import { useEffect, useMemo, useState } from 'react'

export type PickerContact = {
  id: string
  name: string
  phone: string
  do_not_text: boolean
}

function formatPhone(phone: string | null | undefined) {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
}

// Multi-select for txt_contacts. Used by both the group composer and the
// broadcast composer. The unified contacts directory now holds 1,300+ textable
// contacts, well past what a single client-side slice can hold — so the search
// box hits the API (same `?search=` path as the New-conversation search) rather
// than filtering a truncated first-page. With no query we show a browse list
// (first page by name) just to give something to scroll.
export default function TxtContactMultiPicker({
  selectedIds,
  onChange,
  includeBlocked = false,
  emptyHint,
}: {
  selectedIds: string[]
  onChange: (ids: string[]) => void
  includeBlocked?: boolean
  emptyHint?: string
}) {
  // Browse list (no query) and server search results (query >= 2 chars).
  const [contacts, setContacts] = useState<PickerContact[]>([])
  const [results, setResults] = useState<PickerContact[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')

  const blockedParam = includeBlocked ? '&include_do_not_text=1' : ''

  // Initial browse list — first page of textable contacts by name.
  useEffect(() => {
    setLoading(true)
    fetch('/api/txt/contacts?limit=500' + blockedParam)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setContacts(data.contacts || []))
      .catch(() => setContacts([]))
      .finally(() => setLoading(false))
  }, [blockedParam])

  // Server-side search (debounced) so ANY of the 1,300+ contacts is findable —
  // not just the first page. Clears back to the browse list when emptied.
  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setResults(null)
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/txt/contacts?search=${encodeURIComponent(term)}&limit=200` +
            blockedParam
        )
        if (cancelled) return
        const data = res.ok ? await res.json() : { contacts: [] }
        setResults(data.contacts || [])
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, blockedParam])

  // What's on screen: server results when searching, else the browse list.
  const filtered = results !== null ? results : contacts

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  function toggle(id: string) {
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((x) => x !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }

  function selectAll() {
    const visibleIds = filtered.filter((c) => !c.do_not_text).map((c) => c.id)
    const merged = Array.from(new Set([...selectedIds, ...visibleIds]))
    onChange(merged)
  }

  function clearAll() {
    onChange([])
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or phone…"
          className="flex-1 px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
          style={{ fontSize: 16 }}
        />
        <button
          type="button"
          onClick={selectAll}
          className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20"
          disabled={loading}
        >
          All
        </button>
        <button
          type="button"
          onClick={clearAll}
          className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20"
          disabled={selectedIds.length === 0}
        >
          None
        </button>
      </div>
      <div className="text-[11px] text-white/40 mb-1">
        {selectedIds.length} selected · {filtered.length}{' '}
        {results !== null
          ? `match${filtered.length === 1 ? '' : 'es'}`
          : 'shown'}
        {/* Browse list is the first page only — tell the user to search rather
            than letting them assume everyone is listed. */}
        {results === null && contacts.length >= 500 && ' · search to find more'}
      </div>
      <div className="flex-1 overflow-y-auto rounded-md border border-white/10 bg-white/5 min-h-0">
        {loading && <div className="p-3 text-sm text-white/40">Loading contacts…</div>}
        {!loading && searching && filtered.length === 0 && (
          <div className="p-3 text-sm text-white/40">Searching…</div>
        )}
        {!loading && !searching && filtered.length === 0 && (
          <div className="p-3 text-sm text-white/40">
            {query.trim().length >= 2 ? 'No matching contacts.' : emptyHint || 'No contacts.'}
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <ul>
            {filtered.map((c) => {
              const checked = selectedSet.has(c.id)
              return (
                <li
                  key={c.id}
                  className={`border-b border-white/5 last:border-b-0 ${
                    c.do_not_text ? 'opacity-50' : ''
                  }`}
                >
                  <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(c.id)}
                      disabled={c.do_not_text}
                      className="accent-emerald-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">{c.name}</div>
                      <div className="text-[11px] text-white/50 truncate">
                        {formatPhone(c.phone)}
                      </div>
                    </div>
                    {c.do_not_text && (
                      <span className="text-[10px] text-[var(--t-tint-orange)] flex-none">
                        do-not-text
                      </span>
                    )}
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
