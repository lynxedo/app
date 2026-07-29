'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatPhone } from '@/lib/format'
import { contactDisplayName, nameIsAiGuessed } from '@/lib/contact-name'

const PAGE_SIZE = 100

type Tag = { id: string; label: string; color: string }

type Contact = {
  id: string
  name: string
  name_source?: string | null
  first_name?: string | null
  last_name?: string | null
  company_name?: string | null
  is_company?: boolean
  phone: string
  email: string | null
  email_status?: string
  do_not_text: boolean
  notes: string | null
  jobber_client_id: string | null
  sources?: string[]
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  state?: string | null
  postal_code?: string | null
  country?: string | null
  tags: Tag[]
}

function oneLineAddress(c: Contact): string | null {
  const parts = [c.address_line1, c.city, c.state, c.postal_code].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

export default function ContactsPanel({
  initialContacts,
  initialTags,
}: {
  initialContacts: Contact[]
  initialTags: Tag[]
}) {
  const router = useRouter()
  const [contacts, setContacts] = useState<Contact[]>(initialContacts)
  const [tags] = useState<Tag[]>(initialTags)
  const [search, setSearch] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set())
  const [untaggedOnly, setUntaggedOnly] = useState(false)
  const [channel, setChannel] = useState('')   // '' | 'phone' | 'email'
  const [source, setSource] = useState('')      // '' | jobber | manual | import | sms | voice
  const [status, setStatus] = useState('')      // '' | subscribed | unsubscribed | bounced | complained
  const [unnamedOnly, setUnnamedOnly] = useState(false) // "No name" (Unknown) contacts only
  const [showTags, setShowTags] = useState(false) // tag filter collapsed by default (lots of tags)
  const [adding, setAdding] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [total, setTotal] = useState<number | null>(null)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const loadingRef = useRef(false)  // blocks overlapping fetches
  const genRef = useRef(0)          // bumps on every filter change → discards stale/append responses

  // Build the shared query string for one page. `offset` is the start row;
  // `withCount` asks the server for the exact total (first page only).
  const buildParams = useCallback((offset: number, withCount: boolean) => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (selectedTagIds.size > 0) params.set('tag_ids', Array.from(selectedTagIds).join(','))
    if (untaggedOnly) params.set('untagged', '1')
    if (channel) params.set('channel', channel)
    if (source) params.set('source', source)
    if (status) params.set('status', status)
    if (unnamedOnly) params.set('unnamed', '1')
    // The directory shows everyone (do-not-text contacts included, with a
    // badge) — it's an address book, not a send tool.
    params.set('include_do_not_text', '1')
    params.set('limit', String(PAGE_SIZE))
    params.set('offset', String(offset))
    if (withCount) params.set('with_count', '1')
    return params
  }, [search, selectedTagIds, untaggedOnly, channel, source, status, unnamedOnly])

  // Debounced reset-load: refetch page 1 whenever search/filters change.
  useEffect(() => {
    const t = setTimeout(async () => {
      const gen = ++genRef.current
      loadingRef.current = true
      try {
        const res = await fetch(`/api/contacts?${buildParams(0, true).toString()}`)
        if (gen !== genRef.current) return  // a newer filter change superseded this
        if (res.ok) {
          const data = await res.json()
          setContacts(data.contacts ?? [])
          setHasMore(!!data.hasMore)
          setTotal(typeof data.total === 'number' ? data.total : null)
        }
      } finally {
        if (gen === genRef.current) loadingRef.current = false
      }
    }, 200)
    return () => clearTimeout(t)
  }, [buildParams])

  // Append the next page for infinite scroll (offset = rows already loaded).
  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return
    const gen = genRef.current
    loadingRef.current = true
    setLoadingMore(true)
    try {
      const res = await fetch(`/api/contacts?${buildParams(contacts.length, false).toString()}`)
      if (gen !== genRef.current) return  // filters changed mid-flight — drop this page
      if (res.ok) {
        const data = await res.json()
        const incoming: Contact[] = data.contacts ?? []
        setContacts(prev => {
          const seen = new Set(prev.map(c => c.id))
          return [...prev, ...incoming.filter(c => !seen.has(c.id))]
        })
        setHasMore(!!data.hasMore)
      }
    } finally {
      if (gen === genRef.current) loadingRef.current = false
      setLoadingMore(false)
    }
  }, [hasMore, contacts.length, buildParams])

  // Fire loadMore when the bottom sentinel scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      entries => { if (entries[0]?.isIntersecting) loadMore() },
      { root: scrollRef.current, rootMargin: '300px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore])

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

  const anyFilter = !!(search || selectedTagIds.size > 0 || untaggedOnly || channel || source || status || unnamedOnly)
  const totalLabel = useMemo(() => {
    const n = contacts.length.toLocaleString()
    if (total != null && total > contacts.length) return `Showing ${n} of ${total.toLocaleString()}`
    return anyFilter ? `${n} matching` : `${n} contacts`
  }, [contacts.length, anyFilter, total])

  return (
    <div className="h-full flex flex-col bg-[var(--t-panel-deep)] text-white min-h-0">
      <div className="flex-none px-4 py-3 border-b border-white/5 flex items-center justify-between gap-3 max-md:pl-14">
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
          placeholder="Search name, phone or email…"
          className="w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
          style={{ fontSize: 16 }}
        />

        <div className="flex flex-wrap gap-1.5">
          <select value={channel} onChange={e => setChannel(e.target.value)} className={filterSelectCls} title="Channel">
            <option value="">Any channel</option>
            <option value="phone">Has phone</option>
            <option value="email">Has email</option>
          </select>
          <select value={source} onChange={e => setSource(e.target.value)} className={filterSelectCls} title="Source">
            <option value="">Any source</option>
            <option value="jobber">Jobber</option>
            <option value="manual">Manual</option>
            <option value="import">Imported</option>
            <option value="sms">Texted in</option>
            <option value="voice">Called in</option>
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)} className={filterSelectCls} title="Email status">
            <option value="">Any email status</option>
            <option value="subscribed">Subscribed</option>
            <option value="unsubscribed">Unsubscribed</option>
            <option value="bounced">Bounced</option>
            <option value="complained">Complained</option>
          </select>
          <button
            type="button"
            onClick={() => setUnnamedOnly(v => !v)}
            title="Show only contacts without a name (Unknown)"
            className={`text-xs px-2 py-1 rounded-md border ${unnamedOnly ? 'bg-amber-500/20 border-amber-500/40 text-amber-200' : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'}`}
          >
            No name
          </button>
          {(channel || source || status || unnamedOnly) && (
            <button
              type="button"
              onClick={() => { setChannel(''); setSource(''); setStatus(''); setUnnamedOnly(false) }}
              className="text-xs px-2 py-1 rounded-md text-white/40 hover:text-white"
            >
              Reset
            </button>
          )}
        </div>

        {(tags.length > 0) && (
          <div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowTags(v => !v)}
                className="text-xs px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 flex items-center gap-1.5"
              >
                <span className={`transition-transform ${showTags ? 'rotate-90' : ''}`}>▸</span>
                Filter by tag
                <span className="text-white/40">({tags.length})</span>
              </button>
              {(selectedTagIds.size > 0 || untaggedOnly) && (
                <>
                  <span className="text-[11px] text-emerald-300">
                    {untaggedOnly ? 'Untagged' : `${selectedTagIds.size} selected`}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setSelectedTagIds(new Set()); setUntaggedOnly(false) }}
                    className="text-[11px] px-1.5 py-0.5 rounded text-white/40 hover:text-white"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
            {showTags && (
              <div className="mt-2 flex flex-wrap gap-1.5 max-h-44 overflow-y-auto rounded-md bg-black/10 p-2 border border-white/5">
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
              </div>
            )}
          </div>
        )}

        <div className="text-[11px] text-white/40">{totalLabel}</div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        {contacts.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-white/40">
            {anyFilter
              ? 'No contacts match these filters.'
              : 'No contacts yet. Tap + Add to create one.'}
          </div>
        )}
        <ul className="divide-y divide-white/5">
          {contacts.map(c => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => router.push(`/hub/contacts/${c.id}`)}
                className="w-full text-left px-4 py-2.5 hover:bg-white/5 flex items-start justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {c.is_company && <span className="text-[11px]">🏢</span>}
                    <span className={`font-medium text-sm truncate ${contactDisplayName(c.name, c.phone) === 'Unknown' ? 'text-white/50 italic' : ''}`}>{contactDisplayName(c.name, c.phone)}</span>
                    {nameIsAiGuessed(c.name_source) && (
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-none" title="Name suggested by AI — open to confirm" />
                    )}
                    {c.do_not_text && (
                      <span className="text-[9px] uppercase tracking-wide text-orange-300 bg-orange-900/30 px-1.5 py-0.5 rounded">
                        do not text
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-white/40 truncate">
                    {c.phone ? formatPhone(c.phone) : c.email || oneLineAddress(c) || '—'}
                    {c.phone && c.email && <span className="text-white/25"> · {c.email}</span>}
                  </div>
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
        {hasMore && (
          <div ref={sentinelRef} className="px-4 py-4 text-center text-[11px] text-white/30">
            {loadingMore ? 'Loading more…' : ''}
          </div>
        )}
      </div>

      {adding && (
        <AddContactSheet
          tags={tags}
          onClose={() => setAdding(false)}
          onCreated={(newContact) => {
            setAdding(false)
            router.push(`/hub/contacts/${newContact.id}`)
          }}
        />
      )}
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
  const [companyName, setCompanyName] = useState('')
  const [isCompany, setIsCompany] = useState(false)
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [line1, setLine1] = useState('')
  const [city, setCity] = useState('')
  const [stateField, setStateField] = useState('')
  const [postal, setPostal] = useState('')
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
          company_name: companyName.trim() || null, is_company: isCompany,
          address_line1: line1.trim() || null, city: city.trim() || null,
          state: stateField.trim() || null, postal_code: postal.trim() || null,
          tag_ids: Array.from(tagIds),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Save failed'); setSaving(false); return }

      // Build a Contact shape for the parent to insert into list without refetch.
      const newContact: Contact = {
        id: data.id, name: name.trim(),
        company_name: companyName.trim() || null, is_company: isCompany,
        phone: phone.trim().startsWith('+') ? phone.trim() : `+1${phone.trim().replace(/\D/g, '')}`,
        email: email.trim() || null, email_status: 'subscribed', notes: notes.trim() || null,
        address_line1: line1.trim() || null, city: city.trim() || null,
        state: stateField.trim() || null, postal_code: postal.trim() || null,
        do_not_text: false, jobber_client_id: null, sources: ['manual'],
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
      <div className="bg-[var(--t-panel)] border border-white/10 rounded-lg w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-medium">Add contact</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Close">×</button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <Field label="Name *">
            <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputCls} style={{ fontSize: 16 }} autoFocus />
          </Field>
          <Field label="Company">
            <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} className={inputCls} style={{ fontSize: 16 }} />
          </Field>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isCompany} onChange={e => setIsCompany(e.target.checked)} className="w-4 h-4 accent-sky-500" />
            <span className="text-sm">This contact is a business</span>
          </label>
          <Field label="Phone *">
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(281) 555-1234" className={inputCls} style={{ fontSize: 16 }} />
          </Field>
          <Field label="Email">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} style={{ fontSize: 16 }} />
          </Field>
          <Field label="Mailing address">
            <input type="text" value={line1} onChange={e => setLine1(e.target.value)} placeholder="Street" className={inputCls} style={{ fontSize: 16 }} />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <input type="text" value={city} onChange={e => setCity(e.target.value)} placeholder="City" className={inputCls} style={{ fontSize: 16 }} />
            <input type="text" value={stateField} onChange={e => setStateField(e.target.value)} placeholder="State" className={inputCls} style={{ fontSize: 16 }} />
            <input type="text" value={postal} onChange={e => setPostal(e.target.value)} placeholder="ZIP" className={inputCls} style={{ fontSize: 16 }} />
          </div>
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
const filterSelectCls = 'text-xs px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white/70'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-white/50 block mb-1">{label}</label>
      {children}
    </div>
  )
}
