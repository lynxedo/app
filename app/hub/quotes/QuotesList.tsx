'use client'

// Quotes list (Phase 4). Drafts and every sent quote, newest first, with the
// status the customer is actually in (a sent quote past 30 days reads Expired).

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { effectiveStatus, STATUS_LABEL, type QuoteStatus } from '@/lib/quotes'

type Row = {
  id: string
  title: string
  status: QuoteStatus
  customer_name: string
  property_address: string | null
  total_required: number | null
  expires_at: string | null
  updated_at: string
}

const STATUS_STYLE: Record<QuoteStatus, string> = {
  draft: 'bg-white/10 text-gray-300',
  sent: 'bg-sky-500/15 text-sky-200',
  viewed: 'bg-indigo-500/15 text-indigo-200',
  approved: 'bg-emerald-500/15 text-emerald-200',
  changes_requested: 'bg-amber-500/15 text-amber-200',
  expired: 'bg-red-500/15 text-red-200',
  archived: 'bg-white/5 text-gray-500',
}
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export default function QuotesList({ canAdmin }: { canAdmin: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | QuoteStatus>('all')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetch('/api/hub/quotes', { cache: 'no-store' })
      const j = await res.json()
      if (cancelled) return
      if (!res.ok) setError(j.error ?? 'Could not load quotes')
      else setRows(j.quotes)
    })()
    return () => { cancelled = true }
  }, [])

  const shown = (rows ?? []).map(r => ({ ...r, status: effectiveStatus(r) })).filter(r => filter === 'all' || r.status === filter)

  return (
    <div className="flex flex-col h-full">
      <header className="flex-none px-3 md:px-6 pt-4 pb-3 border-b border-gray-800 max-md:pl-14">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-semibold text-white">Quotes</h1>
          <div className="flex gap-2">
            {canAdmin && <Link href="/hub/admin/quotes" className="px-3 py-2 rounded-md bg-white/10 hover:bg-white/20 text-sm text-gray-200">Templates &amp; reviews</Link>}
            <Link href="/hub/quotes/new" className="px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-sm text-white">+ New quote</Link>
          </div>
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-3 md:px-6 py-4 space-y-3">
          <div className="flex gap-1 flex-wrap">
            {(['all', 'draft', 'sent', 'viewed', 'approved', 'changes_requested', 'expired'] as const).map(k => (
              <button key={k} type="button" onClick={() => setFilter(k)}
                className={`px-2.5 py-1 rounded-full text-xs ${filter === k ? 'bg-indigo-600 text-white' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}>
                {k === 'all' ? 'All' : STATUS_LABEL[k]}
              </button>
            ))}
          </div>
          {error && <div className="bg-red-500/10 border border-red-500/30 text-red-200 rounded px-3 py-2 text-sm">{error}</div>}
          {!rows && !error && <div className="text-sm text-gray-500">Loading…</div>}
          {rows && shown.length === 0 && (
            <div className="text-sm text-gray-500">
              {rows.length === 0 ? <>No quotes yet. Start one with <em>+ New quote</em>, or from a customer’s file, a work-order stop or a Lead Tracker card.</> : 'Nothing with that status.'}
            </div>
          )}
          <div className="space-y-2">
            {shown.map(r => (
              <Link key={r.id} href={`/hub/quotes/${r.id}`} className="block rounded-xl border border-gray-800 bg-gray-900 hover:bg-gray-800/60 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{r.customer_name || 'Customer'}</div>
                    <div className="text-xs text-gray-400 truncate">{r.title || 'Untitled'}{r.property_address ? ` · ${r.property_address}` : ''}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                    <div className="text-sm text-gray-200 mt-1">{money(Number(r.total_required ?? 0))}</div>
                  </div>
                </div>
                <div className="text-[11px] text-gray-500 mt-1">Updated {new Date(r.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
