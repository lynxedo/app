'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import ContactModal, { type ContactForModal } from './ContactModal'

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
}

export default function TxtContactsView() {
  const [contacts, setContacts] = useState<ContactForModal[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<ContactForModal | null>(null)
  const [startingId, setStartingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async (term: string) => {
    setLoading(true)
    const qs = new URLSearchParams({ include_do_not_text: '1', limit: '500' })
    if (term.trim()) qs.set('search', term.trim())
    const res = await fetch(`/api/txt/contacts?${qs.toString()}`)
    if (res.ok) {
      const data = await res.json()
      setContacts(data.contacts || [])
    }
    setLoading(false)
  }, [])

  // Debounced search-as-you-type.
  useEffect(() => {
    const t = setTimeout(() => load(search), 250)
    return () => clearTimeout(t)
  }, [search, load])

  async function startConversation(c: ContactForModal) {
    if (startingId) return
    setStartingId(c.id)
    setError('')
    try {
      const res = await fetch('/api/txt/conversations/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: c.phone, name: c.name }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not open a conversation')
        setStartingId(null)
        return
      }
      window.location.href = `/hub/txt/${data.conversation_id}`
    } catch {
      setError('Network error')
      setStartingId(null)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0B2237] text-white">
      <div className="px-4 md:px-6 pt-4 pb-3 border-b border-white/10">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h1 className="text-xl font-semibold">Contacts</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
            >
              + Add contact
            </button>
            <Link
              href="/hub/txt"
              className="text-sm text-white/60 hover:text-white"
            >
              ← Back to Txt
            </Link>
          </div>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or phone…"
          className="w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
          style={{ fontSize: 16 }}
        />
        {error && <div className="text-xs text-red-400 mt-2">{error}</div>}
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-3">
        {loading && contacts.length === 0 && (
          <div className="text-sm text-white/40 py-8 text-center">Loading…</div>
        )}
        {!loading && contacts.length === 0 && (
          <div className="text-sm text-white/40 py-8 text-center border border-dashed border-white/10 rounded-md">
            {search.trim() ? 'No contacts match your search.' : 'No contacts yet. Add one to get started.'}
          </div>
        )}
        <ul className="space-y-1.5 max-w-2xl">
          {contacts.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-md bg-white/5 border border-white/10"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate flex items-center gap-2">
                  {c.name}
                  {c.do_not_text && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 flex-none">
                      do-not-text
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-white/50 truncate">
                  {formatPhone(c.phone)}
                  {c.email ? ` · ${c.email}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-none">
                <button
                  type="button"
                  onClick={() => startConversation(c)}
                  disabled={startingId === c.id || c.do_not_text}
                  title={c.do_not_text ? 'This contact opted out of texts' : 'Open a text conversation'}
                  className="px-2.5 py-1 rounded-md bg-emerald-600/80 hover:bg-emerald-600 text-xs font-medium disabled:opacity-40"
                >
                  {startingId === c.id ? '…' : 'Text'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(c)}
                  className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-xs"
                >
                  Edit
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {addOpen && (
        <ContactModal
          mode="create"
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false)
            load(search)
          }}
        />
      )}

      {editing && (
        <ContactModal
          mode="edit"
          contact={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setContacts((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
