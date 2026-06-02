'use client'

import { useEffect, useMemo, useState } from 'react'

export type PickerContact = {
  id: string
  name: string
  phone: string
  do_not_text: boolean
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
}

// Multi-select for txt_contacts. Used by both the group composer
// and the broadcast composer. Loads /api/txt/contacts once; client-side
// filter on top (covers Heroes' ~100-contact scale fine; if it grows
// we'd push search into the API).
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
  const [contacts, setContacts] = useState<PickerContact[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(
      '/api/txt/contacts?limit=500' +
        (includeBlocked ? '&include_do_not_text=1' : '')
    )
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setContacts(data.contacts || []))
      .catch(() => setContacts([]))
      .finally(() => setLoading(false))
  }, [includeBlocked])

  const filtered = useMemo(() => {
    if (!query.trim()) return contacts
    const needle = query.toLowerCase()
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.phone.toLowerCase().includes(needle)
    )
  }, [contacts, query])

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
    <div className="flex flex-col min-h-0">
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
        {selectedIds.length} selected · {filtered.length} shown
      </div>
      <div className="flex-1 overflow-y-auto rounded-md border border-white/10 bg-white/5 min-h-0">
        {loading && <div className="p-3 text-sm text-white/40">Loading contacts…</div>}
        {!loading && filtered.length === 0 && (
          <div className="p-3 text-sm text-white/40">
            {emptyHint || 'No contacts.'}
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
                      <span className="text-[10px] text-orange-300 flex-none">
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
