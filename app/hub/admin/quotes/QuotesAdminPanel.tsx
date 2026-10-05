'use client'

import { useState } from 'react'
import QuoteTemplatesAdmin from './QuoteTemplatesAdmin'
import QuoteReviewsAdmin from './QuoteReviewsAdmin'

type Tab = 'templates' | 'reviews'

export default function QuotesAdminPanel() {
  const [tab, setTab] = useState<Tab>('templates')
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-white">Quotes</h1>
        <p className="text-sm text-gray-400 mt-1">
          The starting points for a quote and the reviews shown at the bottom of it. Whoever builds a quote picks a template, then
          changes anything they need for that customer.
        </p>
      </div>
      <div className="flex gap-1 border-b border-white/10">
        {([['templates', 'Templates'], ['reviews', 'Reviews']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === k ? 'border-indigo-400 text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'templates' ? <QuoteTemplatesAdmin /> : <QuoteReviewsAdmin />}
    </div>
  )
}
