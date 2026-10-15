'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

// Admin → AI → Gary's account → Prospects (session 5). Commercial prospects from
// free sources: HOAs from the state's list (and who manages each, read from its
// certificate) and apartment complexes Gary finds by web search. Property
// managers are rolled up from both. Finding only — nothing here contacts anyone.

type Prospect = {
  id: string
  kind: 'hoa' | 'apartment'
  name: string
  hoa_type: string | null
  address: string | null
  city: string | null
  zip: string | null
  county: string | null
  phone: string | null
  email: string | null
  website: string | null
  manager_company: string | null
  manager_name: string | null
  manager_phone: string | null
  manager_email: string | null
  manager_address: string | null
  source: 'trec_hoa' | 'web_search'
  source_url: string | null
  status: 'new' | 'researched' | 'not_a_fit'
  matched_client_name: string | null
  researched_at: string | null
  research_error: string | null
  est_cost_usd: number | string | null
}

type Payload = { zips: string[]; cities: string[]; prospects: Prospect[] }
type View = 'hoa' | 'apartment' | 'managers'

const money = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`

/** "Crest Management Company, Inc." and "CREST MANAGEMENT CO" → one company. */
function companyKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !['inc', 'llc', 'ltd', 'co', 'company', 'the', 'corp', 'corporation', 'group', 'management', 'mgmt', 'services', 'association'].includes(w))
    .join(' ') || s.toLowerCase()
}

export default function GaryProspectsSection() {
  const [data, setData] = useState<Payload | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [view, setView] = useState<View>('hoa')
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [certCount, setCertCount] = useState(10)
  const [city, setCity] = useState('')
  const [zipText, setZipText] = useState('')
  const [editingZips, setEditingZips] = useState(false)
  const [hideCustomers, setHideCustomers] = useState(true)
  const [onlyRead, setOnlyRead] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/gary-account/prospects', { cache: 'no-store' })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error || String(res.status))
      setData(j as Payload)
      setLoadErr('')
    } catch (e) {
      setLoadErr(e instanceof Error && e.message.length > 3 ? e.message : "Couldn't load Gary's prospects.")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function act(action: string, body: Record<string, unknown>, working: string, done: (j: Record<string, number>) => string) {
    setBusy(action)
    setMsg(working)
    try {
      const res = await fetch('/api/admin/gary-account/prospects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error || `Failed (${res.status})`)
      setMsg(done(j))
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'That didn’t work just now.')
    } finally {
      setBusy(null)
    }
  }

  async function setStatus(p: Prospect, status: 'not_a_fit' | 'new') {
    setData((d) => (d ? { ...d, prospects: d.prospects.map((x) => (x.id === p.id ? { ...x, status: status === 'not_a_fit' ? 'not_a_fit' : x.researched_at && !x.research_error ? 'researched' : 'new' } : x)) } : d))
    await fetch('/api/admin/gary-account/prospects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'set_status', id: p.id, status }),
    }).catch(() => null)
  }

  const prospects = data?.prospects ?? []
  const hoas = prospects.filter((p) => p.kind === 'hoa')
  const apartments = prospects.filter((p) => p.kind === 'apartment')
  const hoasRead = hoas.filter((p) => p.researched_at && !p.research_error).length
  const hoasToRead = hoas.filter((p) => p.status === 'new' && !p.researched_at && !p.matched_client_name).length
  const customers = prospects.filter((p) => p.matched_client_name).length
  const spent = prospects.reduce((s, p) => s + (Number(p.est_cost_usd) || 0), 0)

  const managers = useMemo(() => {
    const m = new Map<string, { name: string; hoas: Prospect[]; apartments: Prospect[]; contacts: Set<string> }>()
    for (const p of prospects) {
      if (!p.manager_company || p.status === 'not_a_fit') continue
      const k = companyKey(p.manager_company)
      const g = m.get(k) ?? { name: p.manager_company, hoas: [], apartments: [], contacts: new Set<string>() }
      ;(p.kind === 'hoa' ? g.hoas : g.apartments).push(p)
      for (const c of [p.manager_name && [p.manager_name, p.manager_phone, p.manager_email].filter(Boolean).join(' · ')]) if (c) g.contacts.add(c)
      m.set(k, g)
    }
    return [...m.values()].sort((a, b) => b.hoas.length + b.apartments.length - (a.hoas.length + a.apartments.length))
  }, [prospects])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return prospects.filter((p) => {
      if (view !== 'managers' && p.kind !== view) return false
      if (hideCustomers && p.matched_client_name) return false
      if (onlyRead && !(p.researched_at && !p.research_error)) return false
      if (!q) return true
      return [p.name, p.city, p.zip, p.manager_company, p.manager_name].some((v) => (v || '').toLowerCase().includes(q))
    })
  }, [prospects, view, query, hideCustomers, onlyRead])

  const cities = data?.cities ?? []
  const pickedCity = city || cities[0] || ''

  return (
    <section className="border border-white/10 rounded-lg p-4 space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-white">Prospects</h2>
        <p className="text-xs text-white/50 mt-0.5">
          HOAs, apartment complexes, and the companies that manage them, in your area, from free sources. This only
          finds and organizes them; Gary doesn&apos;t contact anyone from here.
        </p>
      </div>

      {loadErr && <p className="text-xs text-red-400">{loadErr}</p>}
      {!data && !loadErr && <p className="text-xs text-white/40">Loading…</p>}

      {data && (
        <>
          <div className="space-y-1">
            <p className="text-xs font-medium text-white/70">Where Gary looks</p>
            {!editingZips ? (
              <p className="text-sm text-white/80">
                {data.zips.length} ZIP codes ({cities.join(', ') || 'none yet'}){' '}
                <button
                  type="button"
                  onClick={() => {
                    setZipText(data.zips.join(', '))
                    setEditingZips(true)
                  }}
                  className="text-xs text-sky-400 hover:underline"
                >
                  Change
                </button>
              </p>
            ) : (
              <div className="space-y-1.5">
                <textarea
                  value={zipText}
                  onChange={(e) => setZipText(e.target.value)}
                  rows={3}
                  className="w-full bg-transparent border border-white/15 rounded px-2 py-1.5 text-sm text-white"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void act('set_zips', { zips: zipText }, 'Saving…', () => {
                        setEditingZips(false)
                        return 'Saved. Tap “Update HOA list” to pick up HOAs in any new ZIPs.'
                      })
                    }
                    className="rounded-lg bg-brand px-3 py-1 text-sm text-white disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button type="button" onClick={() => setEditingZips(false)} className="text-xs text-white/50 hover:text-white">
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <p className="text-xs text-white/40">Started from every ZIP with 3 or more of your customers.</p>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 p-3 space-y-2">
              <p className="text-sm text-white">HOAs: {hoas.length}</p>
              <p className="text-xs text-white/50">From the State of Texas HOA list (management certificates).</p>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void act('import_hoas', {}, 'Getting the state’s HOA list…', (j) => `${j.inArea} HOAs in your ZIPs; ${j.added} new.${j.matched ? ` ${j.matched} match a customer.` : ''}`)
                }
                className="rounded-lg border border-white/15 px-3 py-1 text-sm text-white/80 hover:text-white disabled:opacity-40"
              >
                {busy === 'import_hoas' ? 'Updating…' : 'Update HOA list'}
              </button>
            </div>
            <div className="rounded-lg border border-white/10 p-3 space-y-2">
              <p className="text-sm text-white">
                Who manages them: {hoasRead} read, {hoasToRead} to go
              </p>
              <p className="text-xs text-white/50">Gary reads each certificate. About 2–3 cents each.</p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={certCount}
                  onChange={(e) => setCertCount(Number(e.target.value))}
                  className="bg-transparent border border-white/15 rounded px-2 py-1 text-sm"
                  disabled={busy !== null}
                >
                  {[5, 10, 15].map((n) => (
                    <option key={n} value={n} className="bg-gray-900">
                      {n}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy !== null || hoasToRead === 0}
                  onClick={() =>
                    void act('read_certificates', { count: certCount }, `Gary is reading ${certCount} certificates. Up to a minute…`, (j) =>
                      `Read ${j.read}${j.failed ? `, ${j.failed} couldn’t be read` : ''} (about ${money(j.costUsd)}). ${j.left} to go.`,
                    )
                  }
                  className="rounded-lg border border-white/15 px-3 py-1 text-sm text-white/80 hover:text-white disabled:opacity-40"
                >
                  {busy === 'read_certificates' ? 'Reading…' : 'Read next'}
                </button>
              </div>
            </div>
            <div className="rounded-lg border border-white/10 p-3 space-y-2">
              <p className="text-sm text-white">Apartments: {apartments.length}</p>
              <p className="text-xs text-white/50">Gary searches the web, one city at a time. About 10–20 cents a city.</p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={pickedCity}
                  onChange={(e) => setCity(e.target.value)}
                  className="bg-transparent border border-white/15 rounded px-2 py-1 text-sm"
                  disabled={busy !== null || !cities.length}
                >
                  {cities.map((c) => (
                    <option key={c} value={c} className="bg-gray-900">
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy !== null || !pickedCity}
                  onClick={() =>
                    void act('find_apartments', { city: pickedCity }, `Gary is searching for apartments in ${pickedCity}. Up to a minute…`, (j) =>
                      `Found ${j.found} in ${pickedCity}; ${j.added} new (${j.searches} searches, about ${money(j.costUsd)}).`,
                    )
                  }
                  className="rounded-lg border border-white/15 px-3 py-1 text-sm text-white/80 hover:text-white disabled:opacity-40"
                >
                  {busy === 'find_apartments' ? 'Searching…' : 'Find'}
                </button>
              </div>
            </div>
          </div>
          {msg && <p className="text-xs text-white/60">{msg}</p>}
          <p className="text-xs text-white/40">
            Spent finding prospects so far: about {money(spent)}. {customers} match a current customer (hidden below unless
            you un-tick it).
          </p>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {(
              [
                ['hoa', `HOAs · ${hoas.length}`],
                ['apartment', `Apartments · ${apartments.length}`],
                ['managers', `Property managers · ${managers.length}`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setView(k)
                  setShowAll(false)
                }}
                className={`rounded-full border px-2.5 py-1 ${view === k ? 'border-brand bg-brand/20 text-white' : 'border-white/10 text-white/60 hover:text-white'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, city, ZIP or manager"
              className="w-full sm:w-72 bg-transparent border border-white/15 rounded px-2 py-1.5 text-sm text-white placeholder:text-white/30"
            />
            {view !== 'managers' && (
              <>
                <label className="flex items-center gap-1.5 text-xs text-white/60">
                  <input type="checkbox" checked={hideCustomers} onChange={(e) => setHideCustomers(e.target.checked)} className="accent-brand" />
                  Hide current customers
                </label>
                <label className="flex items-center gap-1.5 text-xs text-white/60">
                  <input type="checkbox" checked={onlyRead} onChange={(e) => setOnlyRead(e.target.checked)} className="accent-brand" />
                  Only ones with a contact
                </label>
              </>
            )}
          </div>

          {view === 'managers' ? (
            managers.length === 0 ? (
              <p className="text-xs text-white/40">No managers yet. Have Gary read some HOA certificates first.</p>
            ) : (
              <div className="divide-y divide-white/5 border border-white/10 rounded-lg">
                {managers
                  .filter((g) => !query.trim() || g.name.toLowerCase().includes(query.trim().toLowerCase()))
                  .slice(0, showAll ? undefined : 100)
                  .map((g) => (
                    <details key={g.name} className="p-3">
                      <summary className="cursor-pointer list-none flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm text-white">{g.name}</span>
                        <span className="text-xs text-white/50">
                          {g.hoas.length ? `${g.hoas.length} HOA${g.hoas.length === 1 ? '' : 's'}` : ''}
                          {g.hoas.length && g.apartments.length ? ' · ' : ''}
                          {g.apartments.length ? `${g.apartments.length} apartment complex${g.apartments.length === 1 ? '' : 'es'}` : ''}
                        </span>
                      </summary>
                      <div className="mt-2 space-y-1">
                        {[...g.contacts].slice(0, 6).map((c) => (
                          <p key={c} className="text-xs text-white/60">
                            {c}
                          </p>
                        ))}
                        <p className="text-xs text-white/40">
                          {[...g.hoas, ...g.apartments].map((p) => `${p.name}${p.city ? ` (${p.city})` : ''}`).join(' · ')}
                        </p>
                      </div>
                    </details>
                  ))}
              </div>
            )
          ) : shown.length === 0 ? (
            <p className="text-xs text-white/40">
              {view === 'hoa' && !hoas.length ? 'No HOAs yet. Tap “Update HOA list”.' : view === 'apartment' && !apartments.length ? 'No apartments yet. Pick a city and tap “Find”.' : 'Nobody here.'}
            </p>
          ) : (
            <div className="divide-y divide-white/5 border border-white/10 rounded-lg">
              {shown.slice(0, showAll ? undefined : 150).map((p) => (
                <div key={p.id} className={`p-3 space-y-1 ${p.status === 'not_a_fit' ? 'opacity-50' : ''}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm text-white">
                      {p.name}
                      <span className="text-xs text-white/40 ml-2">
                        {[p.city, p.zip, p.hoa_type].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {p.matched_client_name && (
                        <span className="text-xs rounded px-2 py-0.5 bg-emerald-500/15 text-emerald-300">Customer: {p.matched_client_name}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => void setStatus(p, p.status === 'not_a_fit' ? 'new' : 'not_a_fit')}
                        className="text-xs text-white/40 hover:text-white"
                      >
                        {p.status === 'not_a_fit' ? 'Undo not a fit' : 'Not a fit'}
                      </button>
                    </span>
                  </div>
                  {p.address && <p className="text-xs text-white/50">{p.address}</p>}
                  {(p.manager_company || p.manager_name) && (
                    <p className="text-xs text-white/70">
                      Managed by {[p.manager_company, p.manager_name].filter(Boolean).join(', ')}
                      {(p.manager_phone || p.manager_email) && (
                        <span className="text-white/50"> · {[p.manager_phone, p.manager_email].filter(Boolean).join(' · ')}</span>
                      )}
                    </p>
                  )}
                  {p.phone && <p className="text-xs text-white/50">Phone: {p.phone}</p>}
                  {p.research_error && <p className="text-xs text-amber-300/80">{p.research_error}</p>}
                  <p className="text-xs text-white/40 flex flex-wrap gap-3">
                    {p.source_url && (
                      <a href={p.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {p.kind === 'hoa' ? 'Certificate (PDF)' : 'Where Gary found it'}
                      </a>
                    )}
                    {p.website && (
                      <a href={p.website} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        Website
                      </a>
                    )}
                    {p.kind === 'hoa' && !p.researched_at && !p.matched_client_name && <span>Not read yet</span>}
                  </p>
                </div>
              ))}
            </div>
          )}
          {!showAll && ((view === 'managers' && managers.length > 100) || (view !== 'managers' && shown.length > 150)) && (
            <button type="button" onClick={() => setShowAll(true)} className="text-xs text-sky-400 hover:underline">
              Show all
            </button>
          )}
          <p className="text-xs text-white/40">
            Apartments come from web search, so check one before you rely on it (each links to the page Gary found it on).
            Reaching out to prospects is a later step; nothing here sends anything.
          </p>
        </>
      )}
    </section>
  )
}
