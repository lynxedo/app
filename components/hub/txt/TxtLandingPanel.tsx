'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type UnknownActivityGroup = {
  phone: string
  phone_e164: string | null
  last_activity_at: string
  call_count: number
  voicemail_count: number
  events: Array<{
    kind: 'call' | 'voicemail'
    id: string
    created_at: string
    status?: string | null
    direction?: string | null
    duration_seconds?: number | null
    preview?: string | null
  }>
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
}

function formatRelative(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function TxtLandingPanel({
  isAdmin,
  canAccessUnifiedInbox = false,
}: {
  isAdmin: boolean
  canAccessUnifiedInbox?: boolean
}) {
  const router = useRouter()
  const [showInject, setShowInject] = useState(false)
  const [phone, setPhone] = useState('+12815550199')
  const [name, setName] = useState('Test Customer')
  const [body, setBody] = useState('Hey, what time are you coming tomorrow?')
  const [status, setStatus] = useState<string>('')

  async function injectInbound() {
    setStatus('Injecting…')
    const res = await fetch('/api/txt/dev/inject-inbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, name, body }),
    })
    const data = await res.json()
    if (!res.ok) {
      setStatus(`Error: ${data.error || 'failed'}`)
      return
    }
    setStatus(`Injected → /hub/txt/${data.conversation_id}`)
    setTimeout(() => {
      router.push(`/hub/txt/${data.conversation_id}`)
    }, 600)
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 text-center overflow-y-auto">
      <div className="text-5xl mb-3">💬</div>
      <h1 className="text-xl font-medium mb-2">Txt</h1>
      <p className="text-sm text-white/50 max-w-md mb-6">
        Pick a conversation from the sidebar, or start a new one with{' '}
        <span className="text-white/80">+ New conversation</span>.
      </p>
      {canAccessUnifiedInbox && <UnknownActivityPanel />}
      {isAdmin && process.env.NODE_ENV !== 'production' && (
        <div className="w-full max-w-md">
          {!showInject ? (
            <button
              onClick={() => setShowInject(true)}
              className="px-3 py-1.5 text-xs rounded-md bg-white/5 hover:bg-white/10 text-white/70"
            >
              🧪 Dev: inject fake inbound
            </button>
          ) : (
            <div className="text-left space-y-2 px-4 py-3 rounded-md bg-white/5 border border-white/10">
              <div className="text-xs text-white/60 font-medium mb-1">
                Inject fake inbound SMS (dev only — exercises the assignment flow without Twilio)
              </div>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone (E.164 +1...)"
                className="w-full px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
              />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contact name"
                className="w-full px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Message body"
                rows={2}
                className="w-full px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={injectInbound}
                  className="flex-1 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm"
                >
                  Inject
                </button>
                <button
                  onClick={() => setShowInject(false)}
                  className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-sm"
                >
                  Close
                </button>
              </div>
              {status && (
                <div className="text-xs text-white/60">{status}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function UnknownActivityPanel() {
  const router = useRouter()
  const [items, setItems] = useState<UnknownActivityGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [savingPhone, setSavingPhone] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const res = await fetch('/api/txt/unknown-activity')
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setError(data.error || 'Could not load unknown activity')
          setItems([])
        } else {
          setItems(data.unknown || [])
        }
      } catch {
        if (!cancelled) setError('Could not load unknown activity')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function saveAsContact(item: UnknownActivityGroup) {
    const phone = item.phone_e164 || item.phone
    if (!phone || savingPhone) return
    setSavingPhone(phone)
    setError('')
    try {
      const res = await fetch('/api/txt/unknown-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, name: phone }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Could not save contact')
        return
      }
      router.push(`/hub/txt/${data.conversation_id}`)
    } catch {
      setError('Could not save contact')
    } finally {
      setSavingPhone(null)
    }
  }

  if (loading) {
    return (
      <div className="w-full max-w-md mb-6 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/45">
        Checking for unknown call activity…
      </div>
    )
  }

  if (items.length === 0 && !error) return null

  return (
    <div className="w-full max-w-md mb-6 text-left rounded-lg border border-white/10 bg-white/[0.03] overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10">
        <div className="text-sm font-medium">Unknown call activity</div>
        <div className="text-xs text-white/45 mt-0.5">
          Save a number to pull its calls and voicemails into one customer thread.
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-[var(--t-tint-danger)] border-b border-red-400/15 bg-red-500/10">
          {error}
        </div>
      )}

      <div className="divide-y divide-white/10">
        {items.map((item) => {
          const latest = item.events[0]
          const phone = item.phone_e164 || item.phone
          return (
            <div key={phone} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">
                    {formatPhone(phone)}
                  </div>
                  <div className="text-xs text-white/45 mt-0.5">
                    {item.call_count} call{item.call_count === 1 ? '' : 's'}
                    {item.voicemail_count > 0 && (
                      <>
                        {' '}· {item.voicemail_count} voicemail{item.voicemail_count === 1 ? '' : 's'}
                      </>
                    )}
                    {' '}· {formatRelative(item.last_activity_at)}
                  </div>
                  {latest?.preview && (
                    <div className="text-xs text-white/55 mt-1 truncate">
                      {latest.preview}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => saveAsContact(item)}
                  disabled={savingPhone === phone}
                  className="flex-none px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs font-medium disabled:opacity-50"
                >
                  {savingPhone === phone ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
