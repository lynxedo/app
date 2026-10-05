'use client'

// Work Orders Phase 2 — the office's view of what techs did to line items and
// what's left to invoice. Data: GET /api/hub/work-orders/office.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import WorkOrderSuggestionRules from './WorkOrderSuggestionRules'

type Base = {
  stopId: string
  date: string | null
  tech: string
  client: string
  address: string
  contactId: string | null
  completedAt: string | null
  autopay: boolean | null
  jobberUrl: string | null
  total: number
}
type Attention = Base & { problem: string; failingItems: Array<{ name: string; error: string | null; gaveUp: boolean }> }
type Changed = Base & {
  changes: Array<{ name: string; kind: 'added' | 'changed' | 'not_done' | 'suggested'; quantity: number; unitPrice: number; origQuantity: number | null; origUnitPrice: number | null }>
}

const fmt = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100))
const fmtDate = (d: string | null) => d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''

export default function WorkOrdersOffice() {
  const [data, setData] = useState<{ needsAttention: Attention[]; changed: Changed[]; readyToInvoice: Base[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'attention' | 'changed' | 'invoice' | 'rules'>('attention')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/hub/work-orders/office', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Could not load')
      setData(j)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  async function markSeen(stopId: string) {
    setData(d => d ? { ...d, changed: d.changed.filter(c => c.stopId !== stopId) } : d)
    await fetch('/api/hub/work-orders/office', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stopId, action: 'reviewed' }),
    }).catch(() => {})
  }

  const tabs: Array<{ key: typeof tab; label: string; count: number | null }> = [
    { key: 'attention', label: 'Needs attention', count: data?.needsAttention.length ?? 0 },
    { key: 'changed', label: 'Changed by techs', count: data?.changed.length ?? 0 },
    { key: 'invoice', label: 'Ready to invoice', count: data?.readyToInvoice.length ?? 0 },
    { key: 'rules', label: 'Inspection rules', count: null },
  ]

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 text-gray-200">
      <div className="flex items-center gap-3 mb-3">
        <Link href="/hub/daily-log-v2" className="text-sm text-gray-400 hover:text-white">‹ Work Orders</Link>
        <h1 className="text-lg font-semibold text-white flex-1">Office: line items &amp; invoicing</h1>
        <button type="button" onClick={() => void load()} className="text-sm text-gray-400 hover:text-white">↻</button>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {tabs.map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm ${tab === t.key ? 'bg-indigo-600 text-white' : 'bg-white/10 text-gray-300'}`}>
            {t.label}{data && t.count != null ? ` · ${t.count}` : ''}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-200 rounded px-3 py-2 text-sm mb-3">{error}</div>}
      {!data && !error && <div className="text-sm text-gray-500">Loading…</div>}

      {data && tab === 'attention' && (
        <List empty="Nothing stuck — every completed stop made it into Jobber."
          help="Completed stops whose line items or completion haven't reached Jobber. They retry every 5 minutes; the visit stays open in Jobber (so autopay isn't charged) until everything lands.">
          {data.needsAttention.map(s => (
            <Card key={s.stopId} s={s}>
              <div className="text-sm text-amber-200 mt-1">⚠ {s.problem}</div>
              {s.failingItems.map((f, i) => (
                <div key={i} className="text-xs text-gray-400 mt-0.5">
                  {f.name}: {f.error ?? 'failed'}{f.gaveUp ? ' — stopped retrying; add it in Jobber by hand' : ''}
                </div>
              ))}
            </Card>
          ))}
        </List>
      )}

      {data && tab === 'changed' && (
        <List empty="No line-item changes to review."
          help="Stops where a tech added items, changed a quantity or price, or marked an item not done. These are already in Jobber — this is so you see them.">
          {data.changed.map(s => (
            <Card key={s.stopId} s={s} action={<button type="button" onClick={() => void markSeen(s.stopId)} className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-xs text-gray-200">Got it</button>}>
              <div className="mt-1 space-y-0.5">
                {s.changes.map((c, i) => (
                  <div key={i} className="text-xs text-gray-300">
                    <span className={c.kind === 'not_done' ? 'text-gray-400' : c.kind === 'changed' ? 'text-amber-200' : 'text-indigo-200'}>
                      {c.kind === 'added' ? 'Added' : c.kind === 'suggested' ? 'Added (from inspection)' : c.kind === 'not_done' ? 'Not done' : 'Changed'}
                    </span>{' '}
                    {c.name} — {fmtQty(c.quantity)} × {fmt(c.unitPrice)}
                    {c.kind === 'changed' && c.origQuantity != null && c.origUnitPrice != null && (
                      <span className="text-gray-500"> (was {fmtQty(c.origQuantity)} × {fmt(c.origUnitPrice)})</span>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </List>
      )}

      {tab === 'rules' && <WorkOrderSuggestionRules />}

      {data && tab === 'invoice' && (
        <List empty="Nothing waiting to be invoiced."
          help="Visits completed through Work Orders that aren't on autopay and have no invoice in Jobber yet. Open the job in Jobber and invoice as usual — autopay customers invoice themselves.">
          {data.readyToInvoice.map(s => <Card key={s.stopId} s={s} />)}
        </List>
      )}
    </div>
  )
}

function List({ children, empty, help }: { children: React.ReactNode[]; empty: string; help: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-2">{help}</p>
      {children.length === 0
        ? <div className="text-sm text-gray-400 bg-white/5 rounded px-3 py-3">{empty}</div>
        : <div className="space-y-2">{children}</div>}
    </div>
  )
}

function Card({ s, children, action }: { s: Base; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-lg px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-white truncate">
            {s.contactId ? <Link href={`/hub/contacts/${s.contactId}`} className="hover:underline">{s.client}</Link> : s.client}
          </div>
          <div className="text-[11px] text-gray-500">
            {fmtDate(s.date)}{s.tech ? ` · ${s.tech}` : ''}{s.total ? ` · ${fmt(s.total)}` : ''}{s.autopay ? ' · autopay' : ''}
          </div>
        </div>
        {s.jobberUrl && (
          <a href={s.jobberUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 px-2.5 py-1 rounded bg-emerald-600/80 hover:bg-emerald-600 text-xs text-white">Jobber ↗</a>
        )}
        {action}
      </div>
      {children}
    </div>
  )
}
