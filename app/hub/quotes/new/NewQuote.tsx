'use client'

// Start a quote (Phase 4, session 3): pick the customer (unless we came from a
// customer file, a work-order stop or a Lead Tracker card), then a template or
// "Start blank". Creates the draft and opens the builder.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Template = { id: string; name: string; service_line: string | null; title: string; default_items: unknown[] }
type Contact = { id: string; name: string | null; first_name: string | null; last_name: string | null; company_name: string | null; phone: string | null; email: string | null; address_line1: string | null; city: string | null }

const inp = 'w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 text-white placeholder-white/30 text-base md:text-sm'
const nameOf = (c: Contact) => (c.name ?? '').trim() || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name || c.phone || 'Unnamed'

export default function NewQuote({ contactId, stopId, leadId }: { contactId: string | null; stopId: string | null; leadId: string | null }) {
  const router = useRouter()
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null)
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Contact[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasSource = !!(contactId || stopId || leadId)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetch('/api/hub/quotes/templates', { cache: 'no-store' })
      const j = await res.json()
      if (!cancelled) setTemplates(res.ok ? j.templates : [])
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const q = search.trim()
    if (hasSource || q.length < 2) return
    let cancelled = false
    const t = setTimeout(async () => {
      const res = await fetch(`/api/contacts?search=${encodeURIComponent(q)}&limit=12&include_do_not_text=1`, { cache: 'no-store' })
      const j = await res.json().catch(() => ({}))
      if (!cancelled) setResults(res.ok ? j.contacts ?? [] : [])
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [search, hasSource])

  async function start(templateId: string | null) {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/hub/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: picked?.id ?? contactId, stopId, leadId, templateId }),
      })
      const j = await res.json()
      if (!res.ok) { setError(j.error ?? 'Could not start the quote'); return }
      router.replace(`/hub/quotes/${j.id}`)
    } finally { setBusy(false) }
  }

  const needCustomer = !hasSource && !picked

  return (
    <div className="flex flex-col h-full">
      <header className="flex-none px-3 md:px-6 pt-4 pb-3 border-b border-gray-800 max-md:pl-14">
        <div className="max-w-2xl mx-auto">
          <Link href="/hub/quotes" className="text-xs text-gray-400 hover:text-white">← Quotes</Link>
          <h1 className="text-lg font-semibold text-white">New quote</h1>
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-3 md:px-6 py-4 space-y-4">
          {error && <div className="bg-red-500/10 border border-red-500/30 text-red-200 rounded px-3 py-2 text-sm">{error}</div>}

          {needCustomer ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-white">1. Who is it for?</h2>
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customers by name, phone or email" className={inp} />
              <div className="divide-y divide-white/5 rounded-md border border-white/10">
                {search.trim().length < 2 && <div className="p-3 text-sm text-gray-500">Type at least 2 letters.</div>}
                {search.trim().length >= 2 && results?.length === 0 && <div className="p-3 text-sm text-gray-500">No match. Add them in Contacts first.</div>}
                {search.trim().length >= 2 && (results ?? []).map(c => (
                  <button key={c.id} type="button" onClick={() => setPicked({ id: c.id, name: nameOf(c) })} className="w-full text-left p-3 hover:bg-white/5">
                    <span className="block text-sm text-white">{nameOf(c)}</span>
                    <span className="block text-[12px] text-gray-500">{[c.phone, c.address_line1, c.city].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <>
              {picked && (
                <div className="text-sm text-gray-300">
                  For <span className="text-white font-medium">{picked.name}</span> · <button type="button" onClick={() => setPicked(null)} className="text-sky-300 hover:text-sky-200">change</button>
                </div>
              )}
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-white">{picked ? '2.' : ''} Start from a template</h2>
                {!templates ? <div className="text-sm text-gray-500">Loading…</div> : (
                  <div className="space-y-2">
                    {templates.length === 0 && <div className="text-sm text-gray-500">No templates yet — a Quotes admin builds them in Admin → Quotes.</div>}
                    {templates.map(t => (
                      <button key={t.id} type="button" disabled={busy} onClick={() => start(t.id)}
                        className="w-full text-left rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] p-3 disabled:opacity-50">
                        <span className="block text-sm font-medium text-white">{t.name}{t.service_line && <span className="text-gray-400 font-normal"> · {t.service_line}</span>}</span>
                        <span className="block text-[12px] text-gray-500">{t.title || 'No title'} · {(t.default_items ?? []).length} line{(t.default_items ?? []).length === 1 ? '' : 's'}</span>
                      </button>
                    ))}
                    <button type="button" disabled={busy} onClick={() => start(null)} className="w-full text-left rounded-lg border border-dashed border-white/15 hover:bg-white/[0.05] p-3 text-sm text-gray-300 disabled:opacity-50">
                      Start blank
                    </button>
                  </div>
                )}
                {busy && <div className="text-sm text-gray-400">Starting the quote…</div>}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
