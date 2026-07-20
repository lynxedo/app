'use client'

import { useEffect, useState } from 'react'

type Account = { id: string; account_type: string; email_address: string; owner_user_id: string | null; status: string }

// Self-service "connect my personal work email" for the Hub Inbox. Any Hub user can attach one
// personal mailbox (Gmail/Outlook) alongside the shared inbox; it starts the Nylas hosted-OAuth flow.
export default function InboxPersonalMailbox({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true)
  const [mailbox, setMailbox] = useState<Account | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/hub/email/accounts')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        const list: Account[] = d?.accounts ?? []
        const mine = list.find((a) => a.account_type === 'personal' && a.owner_user_id === userId) || null
        setMailbox(mine)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [userId])

  const connect = () => {
    window.location.href = '/api/auth/nylas?type=personal'
  }
  const disconnect = async () => {
    if (!mailbox) return
    setBusy(true)
    try {
      await fetch('/api/auth/nylas/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: mailbox.id }),
      })
      setMailbox(null)
    } catch {
      /* ignore */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-6 pt-6 border-t border-gray-800">
      <label className="block text-xs text-gray-400 mb-1.5">Personal work email</label>
      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : mailbox ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm text-gray-200 truncate">{mailbox.email_address}</div>
            <div className="text-xs text-gray-500">Connected{mailbox.status !== 'connected' ? ` · ${mailbox.status}` : ''}</div>
          </div>
          <button
            onClick={disconnect}
            disabled={busy}
            className="shrink-0 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            {busy ? 'Removing…' : 'Disconnect'}
          </button>
        </div>
      ) : (
        <div>
          <button
            onClick={connect}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Connect my email
          </button>
          <p className="text-xs text-gray-500 mt-2">
            Add your own Gmail or Outlook so it shows up in your Hub Inbox alongside the shared inbox. Only you can see
            your personal mail.
          </p>
        </div>
      )}
    </div>
  )
}
