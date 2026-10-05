'use client'

// The reviews a quote can show at the bottom (up to 3 per quote). Ben pastes
// them in himself (Oct 5 2026). After saving one the form stays open, empty,
// so the next can be pasted straight away.

import { useCallback, useEffect, useState } from 'react'

type Review = {
  id: string
  author: string
  rating: number
  body: string
  review_date: string | null
  source: string
  source_url: string | null
  featured: boolean
  sort_order: number
}
type Draft = { id?: string; author: string; rating: number; body: string; review_date: string; source: string; source_url: string; featured: boolean }

const SOURCES: [string, string][] = [['google', 'Google'], ['facebook', 'Facebook'], ['nextdoor', 'Nextdoor'], ['yelp', 'Yelp'], ['angi', 'Angi'], ['other', 'Other']]
const inp = 'w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 text-white placeholder-white/30 text-base md:text-sm'
const blank = (): Draft => ({ author: '', rating: 5, body: '', review_date: '', source: 'google', source_url: '', featured: false })
const stars = (n: number) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n)

export default function QuoteReviewsAdmin() {
  const [reviews, setReviews] = useState<Review[] | null>(null)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/hub/quotes/reviews', { cache: 'no-store' })
    const j = await res.json()
    if (!res.ok) { setError(j.error ?? 'Could not load'); return }
    setReviews(j.reviews)
  }, [])
  useEffect(() => { void load() }, [load])

  async function save() {
    if (!editing || saving) return
    setSaving(true); setError(null); setSaved(null)
    try {
      const res = await fetch('/api/hub/quotes/reviews', {
        method: editing.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      })
      const j = await res.json()
      if (!res.ok) { setError(j.error ?? 'Could not save'); return }
      if (editing.id) setEditing(null)
      else { setEditing({ ...blank(), source: editing.source }); setSaved(`Saved ${editing.author}'s review — paste the next one, or close.`) }
      await load()
    } finally { setSaving(false) }
  }

  async function remove(r: Review) {
    if (!window.confirm(`Remove ${r.author}'s review? Quotes already sent keep showing it.`)) return
    await fetch(`/api/hub/quotes/reviews?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' })
    await load()
  }

  async function toggleFeatured(r: Review) {
    await fetch('/api/hub/quotes/reviews', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: r.id, featured: !r.featured }),
    })
    await load()
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-400">
        Paste in your best reviews. Each quote shows up to <strong className="text-gray-200">3</strong> at the bottom — a template picks its
        three, and whoever builds the quote can swap them. <strong className="text-gray-200">Featured</strong> reviews are listed first when picking.
      </p>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-200 rounded px-3 py-2 text-sm">{error}</div>}
      {saved && !error && <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 rounded px-3 py-2 text-sm">{saved}</div>}

      {editing ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block md:col-span-2">
              <span className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Customer name</span>
              <input value={editing.author} onChange={e => setEditing({ ...editing, author: e.target.value })} placeholder="e.g. Sarah M." className={inp} />
            </label>
            <label className="block">
              <span className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Stars</span>
              <select value={editing.rating} onChange={e => setEditing({ ...editing, rating: Number(e.target.value) })} className={inp}>
                {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{stars(n)} ({n})</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Review</span>
            <textarea value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })} rows={5}
              placeholder="Paste the review text here" className={`${inp} resize-y`} />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Where it was posted</span>
              <select value={editing.source} onChange={e => setEditing({ ...editing, source: e.target.value })} className={inp}>
                {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Date (optional)</span>
              <input type="date" value={editing.review_date} onChange={e => setEditing({ ...editing, review_date: e.target.value })} className={inp} />
            </label>
            <label className="block">
              <span className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Link (optional)</span>
              <input value={editing.source_url} onChange={e => setEditing({ ...editing, source_url: e.target.value })} placeholder="https://…" className={inp} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={editing.featured} onChange={e => setEditing({ ...editing, featured: e.target.checked })} />
            Featured — list it first when picking reviews for a quote
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving} className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-sm text-white disabled:opacity-50">
              {saving ? 'Saving…' : 'Save review'}
            </button>
            <button type="button" onClick={() => { setEditing(null); setError(null); setSaved(null) }} className="px-4 py-2 rounded-md bg-white/10 hover:bg-white/20 text-sm text-gray-300">Close</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { setEditing(blank()); setSaved(null) }}
          className="px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-sm text-white">+ Add review</button>
      )}

      {!reviews ? <div className="text-sm text-gray-500">Loading…</div> : reviews.length === 0 ? (
        <div className="text-sm text-gray-500">No reviews yet. Quotes will simply leave the reviews section off until you add some.</div>
      ) : (
        <div className="space-y-2">
          {reviews.map(r => (
            <div key={r.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white">
                    {r.author} <span className="text-amber-300 font-normal">{stars(r.rating)}</span>
                    {r.featured && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-200">Featured</span>}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {SOURCES.find(s => s[0] === r.source)?.[1] ?? r.source}{r.review_date ? ` · ${new Date(r.review_date + 'T12:00:00').toLocaleDateString()}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-xs">
                  <button type="button" onClick={() => toggleFeatured(r)} className="text-gray-400 hover:text-white">{r.featured ? 'Unfeature' : 'Feature'}</button>
                  <button type="button" onClick={() => { setSaved(null); setEditing({ id: r.id, author: r.author, rating: r.rating, body: r.body, review_date: r.review_date ?? '', source: r.source, source_url: r.source_url ?? '', featured: r.featured }) }}
                    className="text-sky-300 hover:text-sky-200">Edit</button>
                  <button type="button" onClick={() => remove(r)} className="text-red-300 hover:text-red-200">Delete</button>
                </div>
              </div>
              <p className="text-sm text-gray-300 mt-1.5 whitespace-pre-wrap line-clamp-4">{r.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
