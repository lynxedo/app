'use client'

// Admin → Dialer → Blocked callers. The review-and-undo surface for blocking.
//
// The list matters as much as the blocking does: a block is easy to get wrong
// (a fat-fingered digit, a customer mistaken for a spammer) and its symptom is
// silence — the calls simply stop. So this shows every block, WHO made it and
// when, and unblocks in one click.

import { useCallback, useEffect, useState } from 'react'
import { formatPhone } from '@/lib/format'

type BlockedRow = {
  id: string
  phone: string | null
  phone_digits: string
  reason: string | null
  blocks_calls: boolean
  blocks_texts: boolean
  created_at: string
  blocked_by_name: string | null
}

export default function BlockedNumbersPanel() {
  const [rows, setRows] = useState<BlockedRow[]>([])
  const [loading, setLoading] = useState(true)
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/dialer/blocked-numbers')
      const data = await res.json().catch(() => null)
      setRows(Array.isArray(data?.blocked) ? data.blocked : [])
    } catch {
      setRows([])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function block() {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 10) {
      setError('Enter a full 10-digit number')
      return
    }
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/dialer/blocked-numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, reason: reason || undefined }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setError(d?.error || 'Could not block that number')
        return
      }
      setPhone('')
      setReason('')
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function unblock(row: BlockedRow) {
    setBusy(true)
    try {
      await fetch(`/api/dialer/blocked-numbers?phone=${encodeURIComponent(row.phone_digits)}`, {
        method: 'DELETE',
      })
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
      <header>
        <h2 className="font-semibold">Blocked callers</h2>
        <p className="text-xs text-white/50 mt-1">
          Numbers we refuse. A blocked caller hears a busy signal and never rings anyone, reaches
          the auto-attendant, or leaves a voicemail — and their texts are dropped rather than
          landing in Txt. Blocked calls still appear in the Call Log marked{' '}
          <strong className="text-white">Blocked</strong>, so a number blocked by mistake is easy to
          spot and undo.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[10rem]">
          <label className="text-xs text-white/50 block mb-1">Phone number</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(281) 555-1234"
            style={{ fontSize: 16 }}
            className="w-full px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
          />
        </div>
        <div className="flex-1 min-w-[12rem]">
          <label className="text-xs text-white/50 block mb-1">Reason (optional)</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Spam, repeated hang-ups…"
            style={{ fontSize: 16 }}
            className="w-full px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
          />
        </div>
        <button
          type="button"
          onClick={block}
          disabled={busy}
          className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-[#fff] text-sm font-medium disabled:opacity-50"
        >
          Block
        </button>
      </div>
      {error && <p className="text-xs text-[var(--t-tint-danger)]">{error}</p>}

      {loading ? (
        <p className="text-xs text-white/40">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-white/40">No blocked numbers.</p>
      ) : (
        <ul className="divide-y divide-white/10">
          {rows.map((r) => (
            <li key={r.id} className="py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-white">
                  {formatPhone(r.phone || r.phone_digits) || r.phone_digits}
                  {!r.blocks_calls && <span className="ml-2 text-[11px] text-white/40">texts only</span>}
                  {!r.blocks_texts && <span className="ml-2 text-[11px] text-white/40">calls only</span>}
                </div>
                <div className="text-[11px] text-white/40 truncate">
                  {r.reason ? `${r.reason} · ` : ''}
                  blocked{r.blocked_by_name ? ` by ${r.blocked_by_name}` : ''} on{' '}
                  {new Date(r.created_at).toLocaleDateString()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => unblock(r)}
                disabled={busy}
                className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-xs shrink-0 disabled:opacity-50"
              >
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
