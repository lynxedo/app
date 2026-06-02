'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

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
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return raw
}

export default function ContactsPanel({
  initialContacts,
  initialTags,
  canAccessDialer,
}: {
  initialContacts: Contact[]
  initialTags: Tag[]
  canAccessDialer: boolean
}) {
  const router = useRouter()
  const [contacts, setContacts] = useState<Contact[]>(initialContacts)
  const [tags] = useState<Tag[]>(initialTags)
  const [search, setSearch] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set())
  const [untaggedOnly, setUntaggedOnly] = useState(false)
  const [openContact, setOpenContact] = useState<Contact | null>(null)
  const [adding, setAdding] = useState(false)
  const [textingId, setTextingId] = useState<string | null>(null)

  // Open (or reopen) a Txt conversation with this contact and navigate there.
  // Find-or-create happens server-side in /conversations/start, so this works
  // whether or not a thread already exists.
  async function textContact(c: Contact) {
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
      } else {
        setTextingId(null)
      }
    } catch {
      setTextingId(null)
    }
  }

  // Debounced reload from /api/contacts when search or filters change so the
  // tag-filter and search are server-authoritative (handles >200 contacts).
  useEffect(() => {
    const t = setTimeout(async () => {
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      if (selectedTagIds.size > 0) params.set('tag_ids', Array.from(selectedTagIds).join(','))
      if (untaggedOnly) params.set('untagged', '1')
      params.set('limit', '500')
      const res = await fetch(`/api/contacts?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setContacts(data.contacts ?? [])
      }
    }, 200)
    return () => clearTimeout(t)
  }, [search, selectedTagIds, untaggedOnly])

  function toggleTag(id: string) {
    setSelectedTagIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setUntaggedOnly(false)
  }

  function toggleUntagged() {
    setUntaggedOnly(v => !v)
    if (!untaggedOnly) setSelectedTagIds(new Set())
  }

  const totalLabel = useMemo(() => {
    if (search || selectedTagIds.size > 0 || untaggedOnly) {
      return `${contacts.length} matching`
    }
    return `${contacts.length} contacts`
  }, [contacts.length, search, selectedTagIds.size, untaggedOnly])

  return (
    <div className="h-full flex flex-col bg-[#0A1F35] text-white min-h-0">
      <div className="flex-none px-4 py-3 border-b border-white/5 flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Contacts</h1>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
        >
          + Add
        </button>
      </div>

      <div className="flex-none px-4 py-3 space-y-2 border-b border-white/5">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or phone…"
          className="w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
          style={{ fontSize: 16 }}
        />

        {(tags.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={toggleUntagged}
              className={`text-xs px-2 py-1 rounded-full border ${
                untaggedOnly
                  ? 'bg-white/20 border-white/30 text-white'
                  : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
              }`}
            >
              Untagged
            </button>
            {tags.map(tag => {
              const on = selectedTagIds.has(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className={`text-xs px-2 py-1 rounded-full border transition ${
                    on
                      ? 'border-white/40 text-white'
                      : 'border-white/10 text-white/70 hover:border-white/30'
                  }`}
                  style={on ? { backgroundColor: tag.color + 'CC' } : { backgroundColor: tag.color + '33' }}
                >
                  {tag.label}
                </button>
              )
            })}
            {(selectedTagIds.size > 0 || untaggedOnly) && (
              <button
                type="button"
                onClick={() => { setSelectedTagIds(new Set()); setUntaggedOnly(false) }}
                className="text-xs px-2 py-1 rounded-full text-white/40 hover:text-white"
              >
                Clear
              </button>
            )}
          </div>
        )}

        <div className="text-[11px] text-white/40">{totalLabel}</div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {contacts.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-white/40">
            {search || selectedTagIds.size > 0 || untaggedOnly
              ? 'No contacts match these filters.'
              : 'No contacts yet. Tap + Add to create one.'}
          </div>
        )}
        <ul className="divide-y divide-white/5">
          {contacts.map(c => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpenContact(c)}
                className="w-full text-left px-4 py-2.5 hover:bg-white/5 flex items-start justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{c.name}</span>
                    {c.do_not_text && (
                      <span className="text-[9px] uppercase tracking-wide text-orange-300 bg-orange-900/30 px-1.5 py-0.5 rounded">
                        do not text
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-white/40 truncate">{formatPhone(c.phone)}</div>
                  {c.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {c.tags.map(t => (
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
              </button>
            </li>
          ))}
        </ul>
      </div>

      {openContact && (
        <ContactDetailSheet
          contact={openContact}
          tags={tags}
          canAccessDialer={canAccessDialer}
          onClose={() => setOpenContact(null)}
          onUpdated={(updated) => {
            setContacts(prev => prev.map(c => c.id === updated.id ? updated : c))
            setOpenContact(updated)
          }}
          onDeleted={(id) => {
            setContacts(prev => prev.filter(c => c.id !== id))
            setOpenContact(null)
          }}
          onCall={(phone) => router.push(`/hub/dialer?number=${encodeURIComponent(phone)}`)}
          onText={() => textContact(openContact)}
          texting={textingId === openContact.id}
        />
      )}

      {adding && (
        <AddContactSheet
          tags={tags}
          onClose={() => setAdding(false)}
          onCreated={(newContact) => {
            setContacts(prev => {
              const merged = [...prev.filter(c => c.id !== newContact.id), newContact]
              return merged.sort((a, b) => a.name.localeCompare(b.name))
            })
            setAdding(false)
            setOpenContact(newContact)
          }}
        />
      )}
    </div>
  )
}

function ContactDetailSheet({
  contact,
  tags,
  canAccessDialer,
  onClose,
  onUpdated,
  onDeleted,
  onCall,
  onText,
  texting,
}: {
  contact: Contact
  tags: Tag[]
  canAccessDialer: boolean
  onClose: () => void
  onUpdated: (updated: Contact) => void
  onDeleted: (id: string) => void
  onCall: (phone: string) => void
  onText: () => void
  texting: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(contact.name)
  const [phone, setPhone] = useState(contact.phone)
  const [email, setEmail] = useState(contact.email ?? '')
  const [notes, setNotes] = useState(contact.notes ?? '')
  const [doNotText, setDoNotText] = useState(contact.do_not_text)
  const [tagIds, setTagIds] = useState<Set<string>>(new Set(contact.tags.map(t => t.id)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setError(''); setSaving(true)
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), email: email.trim() || null, notes: notes.trim() || null, do_not_text: doNotText }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Save failed'); setSaving(false); return }

      // Save tag set
      const tagRes = await fetch(`/api/contacts/${contact.id}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_ids: Array.from(tagIds) }),
      })
      if (!tagRes.ok) {
        const td = await tagRes.json()
        setError(td.error || 'Tag save failed'); setSaving(false); return
      }

      const updatedTags = tags.filter(t => tagIds.has(t.id))
      onUpdated({ ...data.contact, tags: updatedTags })
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!confirm('Delete this contact? Message and call history with them stays but loses the name.')) return
    const res = await fetch(`/api/contacts/${contact.id}`, { method: 'DELETE' })
    if (res.ok) onDeleted(contact.id)
  }

  function toggleTag(id: string) {
    setTagIds(prev => {
      const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4">
      <div className="bg-[#0F2E47] border border-white/10 rounded-lg w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-medium truncate">{editing ? 'Edit contact' : contact.name}</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Close">×</button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {editing ? (
            <>
              <Field label="Name *">
                <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputCls} style={{ fontSize: 16 }} autoFocus />
              </Field>
              <Field label="Phone *">
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} style={{ fontSize: 16 }} />
              </Field>
              <Field label="Email">
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} style={{ fontSize: 16 }} />
              </Field>
              <Field label="Notes">
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={`${inputCls} resize-none`} style={{ fontSize: 16 }} />
              </Field>
              <label className="flex items-center gap-2 pt-1 cursor-pointer">
                <input type="checkbox" checked={doNotText} onChange={e => setDoNotText(e.target.checked)} className="w-4 h-4 accent-orange-500" />
                <span className="text-sm">Do not text <span className="text-xs text-white/40">(blocks outbound)</span></span>
              </label>
            </>
          ) : (
            <>
              <div className="text-sm text-white/80">{formatPhone(contact.phone)}</div>
              {contact.email && <div className="text-sm text-white/60">{contact.email}</div>}
              {contact.notes && <div className="text-sm text-white/70 whitespace-pre-wrap pt-2 border-t border-white/5">{contact.notes}</div>}
              {contact.do_not_text && (
                <div className="text-xs text-orange-300 bg-orange-900/20 border border-orange-900/30 rounded px-2 py-1">
                  Do not text — outbound messages blocked
                </div>
              )}
            </>
          )}

          <div className="pt-2">
            <div className="text-xs text-white/50 mb-1.5">Tags</div>
            <div className="flex flex-wrap gap-1.5">
              {tags.length === 0 && (
                <span className="text-xs text-white/40">No tags defined yet — ask an admin to create some.</span>
              )}
              {tags.map(t => {
                const on = tagIds.has(t.id)
                const interactive = editing
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => interactive && toggleTag(t.id)}
                    disabled={!interactive}
                    className={`text-xs px-2 py-1 rounded-full border transition ${
                      on ? 'border-white/40 text-white' : 'border-white/10 text-white/60'
                    } ${interactive ? 'hover:border-white/30 cursor-pointer' : 'cursor-default'}`}
                    style={on ? { backgroundColor: t.color + 'CC' } : { backgroundColor: t.color + '33' }}
                  >
                    {t.label}
                  </button>
                )
              })}
            </div>
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>

        <div className="px-4 py-3 border-t border-white/10 flex flex-wrap items-center gap-2">
          {!editing && canAccessDialer && (
            <button type="button" onClick={() => onCall(contact.phone)} className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium">
              📞 Call
            </button>
          )}
          {!editing && (
            <button
              type="button"
              onClick={onText}
              disabled={texting}
              className="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-sm font-medium disabled:opacity-50"
              title="Open a text conversation"
            >
              {texting ? '…' : '💬 Text'}
            </button>
          )}
          {!editing && (
            <button type="button" onClick={() => setEditing(true)} className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-sm">Edit</button>
          )}
          {editing && (
            <>
              <button type="button" onClick={save} disabled={saving} className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => { setEditing(false); setName(contact.name); setPhone(contact.phone); setEmail(contact.email ?? ''); setNotes(contact.notes ?? ''); setDoNotText(contact.do_not_text); setTagIds(new Set(contact.tags.map(t => t.id))) }} disabled={saving} className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-sm">Cancel</button>
            </>
          )}
          {!editing && (
            <button type="button" onClick={remove} className="ml-auto px-2 py-1.5 rounded-md text-red-300 hover:bg-red-900/30 text-xs">
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function AddContactSheet({
  tags,
  onClose,
  onCreated,
}: {
  tags: Tag[]
  onClose: () => void
  onCreated: (c: Contact) => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [tagIds, setTagIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setError('')
    if (!name.trim()) { setError('Name is required'); return }
    if (!phone.trim()) { setError('Phone is required'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), phone: phone.trim(),
          email: email.trim() || null, notes: notes.trim() || null,
          tag_ids: Array.from(tagIds),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Save failed'); setSaving(false); return }

      // Build a Contact shape for the parent to insert into list without refetch.
      const newContact: Contact = {
        id: data.id, name: name.trim(),
        phone: phone.trim().startsWith('+') ? phone.trim() : `+1${phone.trim().replace(/\D/g, '')}`,
        email: email.trim() || null, notes: notes.trim() || null,
        do_not_text: false, jobber_client_id: null,
        tags: tags.filter(t => tagIds.has(t.id)),
      }
      onCreated(newContact)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
      setSaving(false)
    }
  }

  function toggleTag(id: string) {
    setTagIds(prev => {
      const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4">
      <div className="bg-[#0F2E47] border border-white/10 rounded-lg w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-medium">Add contact</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white">×</button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <Field label="Name *">
            <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputCls} style={{ fontSize: 16 }} autoFocus />
          </Field>
          <Field label="Phone *">
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(281) 555-1234" className={inputCls} style={{ fontSize: 16 }} />
          </Field>
          <Field label="Email">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} style={{ fontSize: 16 }} />
          </Field>
          <Field label="Notes">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={`${inputCls} resize-none`} style={{ fontSize: 16 }} />
          </Field>
          {tags.length > 0 && (
            <div>
              <div className="text-xs text-white/50 mb-1.5">Tags</div>
              <div className="flex flex-wrap gap-1.5">
                {tags.map(t => {
                  const on = tagIds.has(t.id)
                  return (
                    <button key={t.id} type="button" onClick={() => toggleTag(t.id)}
                      className={`text-xs px-2 py-1 rounded-full border transition ${
                        on ? 'border-white/40 text-white' : 'border-white/10 text-white/60 hover:border-white/30'
                      }`}
                      style={on ? { backgroundColor: t.color + 'CC' } : { backgroundColor: t.color + '33' }}>
                      {t.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
        <div className="px-4 py-3 border-t border-white/10 flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-sm disabled:opacity-50">Cancel</button>
          <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputCls = 'w-full px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-white/50 block mb-1">{label}</label>
      {children}
    </div>
  )
}
