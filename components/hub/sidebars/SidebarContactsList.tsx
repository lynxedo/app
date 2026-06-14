'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ContactModal from '@/components/hub/txt/ContactModal'
import { Spinner, EmptyState, useToast } from '@/components/ui'

type Tag = { id: string; label: string; color: string }

type Contact = {
  id: string
  name: string
  phone: string
  email: string | null
  do_not_text: boolean
  notes: string | null
  jobber_client_id: string | null
  tags: Tag[]
}

function formatPhone(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '')
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return raw
}

/**
 * Searchable contacts list embedded inside the Dialer + Txt2 sidebars (the
 * "Contacts" tab). Same data + endpoint as the standalone /hub/contacts app —
 * this is just a second, in-context surface onto the shared txt_contacts table.
 *
 * Per-row actions adapt to permission: 📞 Call (canCall → dialer access) and
 * 💬 Text (canText → txt access). Call pre-fills the keypad via
 * /hub/dialer?number=…; Text find-or-creates a thread via
 * /api/txt/conversations/start — both mirroring ContactsPanel.
 */
export default function SidebarContactsList({
  canCall,
  canText,
  onClose,
}: {
  canCall: boolean
  canText: boolean
  onClose?: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [textingId, setTextingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async (term: string) => {
    setLoading(true)
    const params = new URLSearchParams()
    if (term.trim()) params.set('search', term.trim())
    params.set('include_do_not_text', '1')
    params.set('limit', '200')
    const res = await fetch(`/api/contacts?${params.toString()}`)
    if (res.ok) {
      const data = await res.json()
      setContacts(data.contacts ?? [])
    }
    setLoading(false)
  }, [])

  // Debounced search-as-you-type; also runs once on mount (term '').
  useEffect(() => {
    const t = setTimeout(() => load(search), 200)
    return () => clearTimeout(t)
  }, [search, load])

  function call(phone: string) {
    if (!phone) return
    router.push(`/hub/dialer?number=${encodeURIComponent(phone)}`)
    onClose?.()
  }

  async function text(c: Contact) {
    if (textingId) return
    setTextingId(c.id)
    try {
      const res = await fetch('/api/txt/conversations/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: c.phone, name: c.name }),
      })
      const data = await res.json()
      if (res.ok && data.conversation_id) {
        router.push(`/hub/txt/${data.conversation_id}`)
        onClose?.()
      } else {
        setTextingId(null)
        toast.error(data.error ?? "Couldn't start conversation")
      }
    } catch {
      setTextingId(null)
      toast.error("Couldn't start conversation")
    }
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-3 pt-2 pb-2 space-y-2 flex-none">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or phone…"
          className="w-full px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
          style={{ fontSize: 16 }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex-1 px-2 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium border border-white/10"
          >
            + Add
          </button>
          <Link
            href="/hub/contacts"
            onClick={onClose}
            className="flex-1 px-2 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium border border-white/10 text-center"
          >
            Full Contacts ›
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && contacts.length === 0 && (
          <div className="py-12 text-center"><Spinner size={6} /></div>
        )}
        {!loading && contacts.length === 0 && (
          <EmptyState title={search.trim() ? 'No matching contacts.' : 'No contacts yet. Tap + Add.'} />
        )}
        <ul className="divide-y divide-white/5">
          {contacts.map((c) => (
            <li key={c.id} className="px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{c.name}</span>
                  {c.do_not_text && (
                    <span className="text-[9px] uppercase tracking-wide text-orange-300 bg-orange-900/30 px-1.5 py-0.5 rounded flex-none">
                      no text
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-white/40 truncate">{formatPhone(c.phone)}</div>
                {c.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {c.tags.map((t) => (
                      <span
                        key={t.id}
                        className="text-[9px] px-1.5 py-0.5 rounded-full border border-white/10"
                        style={{ backgroundColor: t.color + '33', color: t.color }}
                      >
                        {t.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {(canCall || canText) && (
                <div className="mt-2 flex items-center gap-1.5">
                  {canCall && (
                    <button
                      type="button"
                      onClick={() => call(c.phone)}
                      disabled={!c.phone}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-emerald-700/30 hover:bg-emerald-700/50 text-emerald-100 disabled:opacity-40"
                      title="Call (pre-fills the keypad)"
                    >
                      📞 Call
                    </button>
                  )}
                  {canText && (
                    <button
                      type="button"
                      onClick={() => text(c)}
                      disabled={!c.phone || textingId === c.id}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-sky-700/30 hover:bg-sky-700/50 text-sky-100 disabled:opacity-40"
                      title="Open a text conversation"
                    >
                      {textingId === c.id ? '…' : '💬 Text'}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {adding && (
        <ContactModal
          mode="create"
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false)
            load(search)
          }}
        />
      )}
    </div>
  )
}
