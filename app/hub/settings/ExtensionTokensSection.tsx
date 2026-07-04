'use client'

import { useCallback, useEffect, useState } from 'react'
import { useToast, useConfirm } from '@/components/ui'

// Settings → Integrations → Browser Extension. Mint / list / revoke the per-user
// API tokens the Lynxedo browser extension uses to authenticate (it can't reuse
// the app's session cookie cross-origin). The raw token is shown exactly once.

type TokenRow = {
  id: string
  label: string | null
  token_prefix: string
  last_used_at: string | null
  created_at: string
  revoked_at: string | null
}

function relTime(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const day = 86_400_000
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < day) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`
  return d.toLocaleDateString()
}

export default function ExtensionTokensSection() {
  const toast = useToast()
  const confirm = useConfirm()
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [loading, setLoading] = useState(true)
  const [label, setLabel] = useState('')
  const [minting, setMinting] = useState(false)
  const [freshToken, setFreshToken] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/extension/token')
      if (!res.ok) throw new Error('load failed')
      const d = await res.json()
      setTokens(d.tokens ?? [])
    } catch {
      /* non-fatal — show empty state */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const mint = async () => {
    setMinting(true)
    setFreshToken(null)
    try {
      const res = await fetch('/api/extension/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || null }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error || 'Could not create token'); return }
      setFreshToken(d.raw)
      setLabel('')
      await load()
    } catch {
      toast.error('Network error')
    } finally {
      setMinting(false)
    }
  }

  const revoke = async (id: string) => {
    const ok = await confirm({
      title: 'Revoke this token?',
      message: 'Any extension using it will stop working immediately. This cannot be undone.',
      confirmText: 'Revoke',
      danger: true,
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/extension/token?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) { toast.error('Revoke failed'); return }
      await load()
    } catch {
      toast.error('Network error')
    }
  }

  const copy = async (t: string) => {
    try { await navigator.clipboard.writeText(t); toast.success('Copied') }
    catch { toast.error('Copy failed — select and copy manually') }
  }

  const active = tokens.filter((t) => !t.revoked_at)

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <h2 className="font-semibold text-lg mb-1">Browser Extension</h2>
      <p className="text-gray-400 text-sm mb-5">
        Generate a token to connect the Lynxedo browser extension, which scans a web page for
        contacts and lets you add, text, or call them. Paste the token into the extension&apos;s
        settings. Treat it like a password — anyone with it can act as you.
      </p>

      {/* Freshly-minted token — shown once */}
      {freshToken && (
        <div className="mb-5 rounded-xl border border-orange-500/40 bg-orange-500/10 p-4">
          <p className="text-sm text-orange-200 font-medium mb-2">
            Copy this token now — you won&apos;t be able to see it again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all text-xs bg-black/40 rounded-lg px-3 py-2 text-orange-100">
              {freshToken}
            </code>
            <button
              onClick={() => copy(freshToken)}
              className="flex-none px-3 py-2 bg-orange-500 hover:bg-orange-400 text-white rounded-lg text-sm font-medium"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {/* Mint */}
      <div className="flex items-center gap-2 mb-5">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. My laptop)"
          maxLength={80}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-orange-500"
        />
        <button
          onClick={mint}
          disabled={minting}
          className="flex-none px-4 py-2 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
        >
          {minting ? 'Generating…' : 'Generate token'}
        </button>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : active.length === 0 ? (
        <p className="text-sm text-gray-500">No active tokens yet.</p>
      ) : (
        <ul className="divide-y divide-gray-800 border border-gray-800 rounded-xl overflow-hidden">
          {active.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm text-gray-200 truncate">
                  {t.label || 'Untitled token'}{' '}
                  <span className="text-gray-500 font-mono text-xs">{t.token_prefix}</span>
                </div>
                <div className="text-xs text-gray-500">
                  Last used {relTime(t.last_used_at)} · created {new Date(t.created_at).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => revoke(t.id)}
                className="flex-none px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded-lg text-xs font-medium"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
