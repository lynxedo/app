'use client'

// The customer's quote page: review, tick add-ons, approve by typing their
// name (Ben, Oct 5 2026) or ask for changes. 30 days after sending it reads
// Expired and can't be approved. Mobile-first — mostly opened from a text.

import { useEffect, useState } from 'react'
import CustomerQuoteView from '@/components/quotes/CustomerQuoteView'
import type { PublicQuoteView } from '@/lib/quote-public'

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

export default function QuotePublic({ token, initial }: { token: string; initial: PublicQuoteView }) {
  const [view, setView] = useState(initial)
  const [name, setName] = useState('')
  const [asking, setAsking] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [thanks, setThanks] = useState<null | 'approved' | 'changes'>(null)

  // Count a view only when a real browser runs the page (not a link preview).
  useEffect(() => { void fetch(`/api/quote/${encodeURIComponent(token)}/view`, { method: 'POST' }).catch(() => {}) }, [token])

  const status = view.quote.status
  const expired = status === 'expired'
  const approved = view.approved

  async function post(path: 'approve' | 'changes', body: unknown) {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/quote/${encodeURIComponent(token)}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error ?? 'Something went wrong — please try again.'); return false }
      if (j.view) setView(j.view)
      return true
    } finally { setBusy(false) }
  }

  const banner = approved ? (
    <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-emerald-900">
      <div className="font-semibold">{thanks === 'approved' ? 'Thank you — your quote is approved!' : 'Approved'}</div>
      <div className="text-sm mt-0.5">Approved by {approved.name} on {fmtDate(approved.at)} · {money(approved.total)}. We’ll be in touch to schedule.</div>
      {view.depositPayUrl && (
        <a href={view.depositPayUrl} target="_blank" rel="noopener noreferrer"
          className="mt-3 inline-block rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 font-semibold">Pay deposit</a>
      )}
    </div>
  ) : expired ? (
    <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-amber-900 text-sm">
      This quote expired{view.quote.expiresAt ? ` on ${fmtDate(view.quote.expiresAt)}` : ''}. Please call us at {view.business.phone} for an updated one.
    </div>
  ) : view.changesRequestedAt ? (
    <div className="rounded-xl bg-sky-50 border border-sky-200 px-4 py-3 text-sky-900 text-sm">
      {thanks === 'changes' ? 'Thanks — we got your note and will be in touch soon.' : 'You asked for changes — we’ll be in touch.'} You can still approve this quote as it is.
    </div>
  ) : null

  return (
    <main className="min-h-screen bg-white">
      {banner && <div className="max-w-2xl mx-auto px-4 pt-4">{banner}</div>}
      <CustomerQuoteView
        key={approved ? 'approved' : 'open'}
        quote={view.quote}
        mode="live"
        initialPicked={approved?.pickedIds}
        locked={!!approved || expired}
        footer={(picked, total) => (approved || expired) ? null : (
          <div className="space-y-3">
            {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 px-3 py-2 text-sm">{error}</div>}
            {!asking ? (
              <>
                <label className="block">
                  <span className="block text-sm font-medium text-gray-800 mb-1">Type your full name to approve</span>
                  <input value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="Your name"
                    className="w-full rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </label>
                <p className="text-xs text-gray-500">By approving you agree to the work and terms on this page{picked.size ? `, including ${picked.size} add-on${picked.size === 1 ? '' : 's'}` : ''}, for {money(total)}.</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button type="button" disabled={busy || name.trim().length < 2}
                    onClick={async () => { if (await post('approve', { name, picked: Array.from(picked) })) setThanks('approved') }}
                    className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white py-3 font-semibold disabled:opacity-50">
                    {busy ? 'Approving…' : `Approve — ${money(total)}`}
                  </button>
                  <button type="button" onClick={() => { setAsking(true); setError(null) }}
                    className="flex-1 rounded-lg border border-gray-300 py-3 font-semibold text-gray-700 hover:bg-gray-50">Request changes</button>
                </div>
              </>
            ) : (
              <>
                <label className="block">
                  <span className="block text-sm font-medium text-gray-800 mb-1">What would you like changed?</span>
                  <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </label>
                <div className="flex gap-2">
                  <button type="button" disabled={busy || message.trim().length < 3}
                    onClick={async () => { if (await post('changes', { message })) { setThanks('changes'); setAsking(false); setMessage('') } }}
                    className="flex-1 rounded-lg bg-gray-900 text-white py-3 font-semibold disabled:opacity-50">{busy ? 'Sending…' : 'Send'}</button>
                  <button type="button" onClick={() => setAsking(false)} className="rounded-lg border border-gray-300 px-4 py-3 font-semibold text-gray-700">Back</button>
                </div>
              </>
            )}
            <p className="text-xs text-gray-500 text-center">Questions? Call us at {view.business.phone}.</p>
          </div>
        )}
      />
    </main>
  )
}
