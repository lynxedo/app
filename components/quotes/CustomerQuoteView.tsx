'use client'

// What the customer sees (Work Orders & Quotes PRD — Phase 4). Rendered from
// the allowlisted CustomerQuote shape only (lib/quotes.ts toCustomerQuote), so
// nothing internal can reach it. Used by the builder's Preview now and by the
// public /quote/[token] page once sending is built. Light, mobile-first — it
// will mostly be opened from a text.
//
// Add-ons start UNTICKED (Ben, Sep 30 2026): the customer ticks what they want
// and the total updates live. In preview, Approve / Request changes are shown
// but do nothing.

import { useMemo, useState, type ReactNode } from 'react'
import { depositAmount, type CustomerQuote } from '@/lib/quotes'

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const SOURCE_LABEL: Record<string, string> = { google: 'Google', facebook: 'Facebook', nextdoor: 'Nextdoor', yelp: 'Yelp', angi: 'Angi' }

export default function CustomerQuoteView({ quote, mode, footer, initialPicked, locked = false }: {
  quote: CustomerQuote
  mode: 'preview' | 'live'
  /** Add-ons already chosen (an approved quote shows them ticked). */
  initialPicked?: string[]
  /** Approved / expired: the ticks can't change. */
  locked?: boolean
  /** The approve / request-changes area (live page); preview shows a stand-in. */
  footer?: (picked: Set<string>, total: number) => ReactNode
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initialPicked ?? []))
  const required = quote.items.filter(i => !i.optional)
  const addOns = quote.items.filter(i => i.optional)
  const total = useMemo(() => {
    let t = 0
    for (const i of quote.items) if (!i.optional || picked.has(i.id)) t += i.total
    return Math.round(t * 100) / 100
  }, [quote.items, picked])
  const deposit = quote.deposit ? depositAmount(total, quote.deposit.type, quote.deposit.value) : null
  const toggle = (id: string) => !locked && setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <div className="bg-white text-gray-900 min-h-full">
      <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10 space-y-6">
        <header className="space-y-1">
          <div className="text-sm font-semibold text-emerald-700">{quote.companyName}</div>
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight">{quote.title || 'Your quote'}</h1>
          <div className="text-sm text-gray-600">
            Prepared for <span className="font-medium text-gray-800">{quote.customerName}</span>
            {quote.propertyAddress && <> · {quote.propertyAddress}</>}
          </div>
          {quote.expiresAt && (
            <div className="text-xs text-gray-500">Valid until {new Date(quote.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
          )}
        </header>

        {quote.intro && <p className="text-[15px] leading-relaxed text-gray-800 whitespace-pre-wrap">{quote.intro}</p>}

        {required.length > 0 && (
          <section className="rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 text-sm font-semibold text-gray-700">What’s included</div>
            <ul className="divide-y divide-gray-100">
              {required.map(i => (
                <li key={i.id} className="px-4 py-3 flex justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium">{i.name}</div>
                    {i.description && <div className="text-sm text-gray-600 whitespace-pre-wrap mt-0.5">{i.description}</div>}
                    {i.quantity !== 1 && <div className="text-xs text-gray-500 mt-0.5">{i.quantity} × {money(i.unit_price)}</div>}
                  </div>
                  <div className="font-medium shrink-0">{money(i.total)}</div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {addOns.length > 0 && (
          <section className="rounded-xl border border-emerald-200 overflow-hidden">
            <div className="px-4 py-2.5 bg-emerald-50 text-sm font-semibold text-emerald-900">Add-ons — optional{!locked && <span className="font-normal text-emerald-800"> · tick any you’d like</span>}</div>
            <ul className="divide-y divide-emerald-100">
              {addOns.map(i => {
                const on = picked.has(i.id)
                return (
                  <li key={i.id}>
                    <label className={`px-4 py-3 flex gap-3 ${locked ? '' : 'cursor-pointer'}`}>
                      <input type="checkbox" checked={on} disabled={locked} onChange={() => toggle(i.id)} className="mt-1 h-5 w-5 accent-emerald-600 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{i.name}</span>
                        {i.recommended && <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-100 rounded px-1.5 py-0.5">Recommended</span>}
                        {i.description && <span className="block text-sm text-gray-600 whitespace-pre-wrap mt-0.5">{i.description}</span>}
                        {i.quantity !== 1 && <span className="block text-xs text-gray-500 mt-0.5">{i.quantity} × {money(i.unit_price)}</span>}
                      </span>
                      <span className={`font-medium shrink-0 ${on ? '' : 'text-gray-400'}`}>{money(i.total)}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <section className="rounded-xl bg-gray-900 text-white px-4 py-4 space-y-1">
          <div className="flex justify-between items-baseline">
            <span className="text-sm text-gray-300">Total</span>
            <span className="text-2xl font-bold">{money(total)}</span>
          </div>
          {deposit != null && deposit > 0 && (
            <div className="flex justify-between text-sm text-gray-300">
              <span>Deposit due on approval{quote.deposit?.type === 'percent' ? ` (${quote.deposit.value}%)` : ''}</span>
              <span>{money(deposit)}</span>
            </div>
          )}
        </section>

        {footer ? footer(picked, total) : mode === 'preview' && (
          <div className="space-y-2">
            <div className="rounded-xl border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500">
              The customer types their name here to approve, or asks for changes. (Preview — these don’t do anything.)
            </div>
            <div className="flex gap-2">
              <button type="button" disabled className="flex-1 rounded-lg bg-emerald-600 text-white py-3 font-semibold opacity-60">Approve</button>
              <button type="button" disabled className="flex-1 rounded-lg border border-gray-300 py-3 font-semibold text-gray-700 opacity-60">Request changes</button>
            </div>
          </div>
        )}

        {quote.reviews.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">What our customers say</h2>
            {quote.reviews.map((r, n) => (
              <figure key={n} className="rounded-xl border border-gray-200 px-4 py-3">
                <div className="text-amber-500 text-sm" aria-label={`${r.rating} stars`}>{'★'.repeat(r.rating)}<span className="text-gray-300">{'★'.repeat(5 - r.rating)}</span></div>
                <blockquote className="text-[15px] text-gray-800 mt-1 whitespace-pre-wrap">{r.body}</blockquote>
                <figcaption className="text-xs text-gray-500 mt-1.5">— {r.author}{SOURCE_LABEL[r.source] ? ` · ${SOURCE_LABEL[r.source]}` : ''}</figcaption>
              </figure>
            ))}
          </section>
        )}

        {quote.terms && (
          <section className="space-y-1">
            <h2 className="text-sm font-semibold text-gray-700">Terms</h2>
            <p className="text-xs leading-relaxed text-gray-600 whitespace-pre-wrap">{quote.terms}</p>
          </section>
        )}
      </div>
    </div>
  )
}
