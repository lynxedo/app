'use client'

import Link from 'next/link'
import { useEffect, useState, useRef, useCallback } from 'react'
import { usePathname } from 'next/navigation'

type Contact = {
  id: string
  name: string
  phone: string
  email: string | null
  jobber_client_id: string | null
  do_not_text: boolean
  updated_at: string
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
}

export default function ClientsSidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [showNewContact, setShowNewContact] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadContacts = useCallback((q: string) => {
    setLoading(true)
    const url = `/api/hub/clients${q ? `?search=${encodeURIComponent(q)}` : ''}`
    fetch(url)
      .then(r => r.json())
      .then(d => {
        setContacts(d.contacts ?? [])
        setTotal(d.total ?? 0)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadContacts('') }, [loadContacts])

  function handleSearch(value: string) {
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => loadContacts(value), 300)
  }

  async function saveNewContact() {
    if (!newName.trim() || !newPhone.trim() || saving) return
    setSaving(true)
    setSaveError('')
    const res = await fetch('/api/hub/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), phone: newPhone.trim(), email: newEmail.trim() || null }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) {
      setSaveError(data.error ?? 'Failed to save')
      return
    }
    setContacts(prev => [data, ...prev].sort((a, b) => a.name.localeCompare(b.name)))
    setTotal(t => t + 1)
    setShowNewContact(false)
    setNewName(''); setNewPhone(''); setNewEmail('')
  }

  return (
    <>
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Search bar */}
        <div className="px-3 pt-3 pb-2">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search clients…"
              className="w-full bg-white/10 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-white/30 outline-none focus:border-[#2E7EB8] focus:bg-white/15 transition-colors"
            />
          </div>
        </div>

        {/* New contact button */}
        <div className="px-3 pb-2">
          <button
            onClick={() => { setShowNewContact(true); setNewName(''); setNewPhone(''); setNewEmail(''); setSaveError('') }}
            className="w-full text-xs text-white/50 hover:text-white/80 hover:bg-white/10 transition-colors py-1.5 px-2 rounded-lg text-left flex items-center gap-1.5"
          >
            <span className="text-base leading-none">+</span>
            <span>New contact</span>
          </button>
        </div>

        {/* Contact list */}
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {loading && contacts.length === 0 && (
            <p className="text-xs text-white/30 px-2 py-2">Loading…</p>
          )}
          {!loading && contacts.length === 0 && (
            <p className="text-xs text-white/30 px-2 py-2">
              {search ? 'No contacts found' : 'No contacts yet — add one above'}
            </p>
          )}
          {contacts.map(contact => {
            const isActive = pathname === `/hub/clients/${contact.id}`
            return (
              <Link
                key={contact.id}
                href={`/hub/clients/${contact.id}`}
                onClick={() => onClose?.()}
                className={`flex flex-col px-2 py-2 rounded-lg transition-colors ${
                  isActive ? 'bg-[#2E7EB8] text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="text-sm font-medium truncate">{contact.name}</span>
                <span className={`text-xs truncate ${isActive ? 'text-white/70' : 'text-white/40'}`}>
                  {formatPhone(contact.phone)}
                  {contact.do_not_text && ' · DNT'}
                </span>
              </Link>
            )
          })}
          {contacts.length > 0 && contacts.length < total && (
            <p className="text-xs text-white/30 px-2 py-2 text-center">
              Showing {contacts.length} of {total}
            </p>
          )}
        </div>
      </div>

      {/* New contact modal */}
      {showNewContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="font-semibold text-white">New Contact</h2>
              <button onClick={() => setShowNewContact(false)} className="text-gray-500 hover:text-gray-300 transition-colors">✕</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Full name"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
              />
              <input
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveNewContact()}
                placeholder="Phone number"
                type="tel"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
              />
              <input
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="Email (optional)"
                type="email"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
              />
              {saveError && <p className="text-xs text-red-400">{saveError}</p>}
            </div>
            <div className="px-5 py-4 border-t border-gray-800 flex gap-3">
              <button
                onClick={() => setShowNewContact(false)}
                className="flex-1 py-2 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveNewContact}
                disabled={!newName.trim() || !newPhone.trim() || saving}
                className="flex-1 py-2 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
