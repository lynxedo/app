'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast, useConfirm } from '@/components/ui'

// Settings → Claude Connection. Lets a user point their own Claude (claude.ai,
// Claude Code, the desktop app) at this Hub's MCP endpoint. Two paths:
//   • claude.ai custom connector — signs in with the normal Lynxedo login, no token.
//   • Claude Code / cowork — needs a personal access token, minted here and shown once.
// Consumes /api/mcp/tokens; always scoped to the caller's own connections.

type Connection = {
  id: string
  kind: 'token' | 'app'
  label: string | null
  prefix: string | null
  created_at: string
  last_used_at: string | null
}

type TokensPayload = {
  mcp_url: string
  enabled: boolean
  assistant_enabled: boolean
  tokens: Connection[]
}

function shortDate(iso: string | null): string {
  if (!iso) return 'never'
  return new Date(iso).toLocaleDateString()
}

export default function ClaudeConnectionSection() {
  const toast = useToast()
  const confirm = useConfirm()
  const [data, setData] = useState<TokensPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  // The raw secret lives in component state ONLY — never localStorage, never a
  // URL — so any navigation or refresh drops it, as intended.
  const [freshToken, setFreshToken] = useState<string | null>(null)

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp/tokens')
      if (!res.ok) throw new Error('load failed')
      const d = (await res.json()) as TokensPayload
      if (!alive.current) return
      setData(d)
      setFailed(false)
    } catch {
      if (alive.current) setFailed(true)
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied')
    } catch {
      toast.error('Copy failed — select and copy manually')
    }
  }

  const create = async () => {
    setCreating(true)
    setFreshToken(null)
    try {
      const res = await fetch('/api/mcp/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || undefined }),
      })
      const d = await res.json()
      if (!res.ok) {
        toast.error(d.error || 'Could not create an access token')
        return
      }
      setFreshToken(d.token)
      setLabel('')
      await load()
    } catch {
      toast.error('Network error')
    } finally {
      if (alive.current) setCreating(false)
    }
  }

  const revoke = async (c: Connection) => {
    const ok = await confirm({
      title: 'Revoke this connection?',
      message:
        c.kind === 'app'
          ? 'That Claude app will lose access to your Hub immediately. You can connect it again later.'
          : 'Anything using this access token will stop working immediately. This cannot be undone.',
      confirmText: 'Revoke',
      danger: true,
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/mcp/tokens?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error('Revoke failed')
        return
      }
      await load()
    } catch {
      toast.error('Network error')
    }
  }

  if (loading) {
    return (
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Claude Connection</h2>
        <p className="text-sm text-gray-500">Loading…</p>
      </section>
    )
  }

  if (failed || !data) {
    return (
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Claude Connection</h2>
        <p className="text-gray-400 text-sm mb-4">We couldn&apos;t load your Claude connections.</p>
        <button
          onClick={() => {
            setLoading(true)
            void load()
          }}
          className="px-4 py-2 bg-orange-500 hover:bg-orange-400 text-[#fff] rounded-lg text-sm font-medium transition-colors"
        >
          Try again
        </button>
      </section>
    )
  }

  // Turned off for the company — explain which switch is off and stop. No URL and
  // no create button, since neither would work yet.
  if (!data.enabled) {
    return (
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Claude Connection</h2>
        <p className="text-gray-400 text-sm">
          {data.assistant_enabled
            ? 'Connecting outside Claude apps to the Hub isn’t enabled yet.'
            : 'The Hub Assistant isn’t switched on for this company yet.'}{' '}
          An admin can change that in Admin → AI → Assistant.
        </p>
      </section>
    )
  }

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <h2 className="font-semibold text-lg mb-1">Claude Connection</h2>
      <p className="text-gray-400 text-sm mb-5">
        Connect your own Claude — claude.ai, Claude Code, or the desktop app — to this Hub, so you
        can ask it about your work here. It only ever sees what you can already see.
      </p>

      {/* MCP endpoint */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-300 mb-2">Hub address</label>
        <div className="flex items-center gap-2">
          <code className="flex-1 break-all text-xs bg-black/40 border border-gray-800 rounded-lg px-3 py-2 text-gray-200">
            {data.mcp_url}
          </code>
          <button
            onClick={() => copy(data.mcp_url)}
            className="flex-none px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-100 rounded-lg text-sm font-medium transition-colors"
          >
            Copy
          </button>
        </div>
      </div>

      {/* claude.ai — no token needed */}
      <div className="mb-6 rounded-xl border border-gray-800 bg-gray-950/40 p-4">
        <h3 className="text-sm font-semibold text-gray-200 mb-2">Connecting claude.ai</h3>
        <ol className="text-sm text-gray-400 space-y-1 list-decimal list-inside">
          <li>In Claude, open Settings → Connectors.</li>
          <li>Choose to add a custom connector.</li>
          <li>Paste the Hub address above.</li>
          <li>Sign in with your normal Lynxedo login, then approve the connection.</li>
        </ol>
        <p className="text-xs text-gray-500 mt-3">
          No token needed for this — you sign in the same way you sign into the Hub.
        </p>
      </div>

      {/* Access token — for Claude Code / cowork */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-200 mb-1">Claude Code or cowork</h3>
        <p className="text-sm text-gray-400 mb-3">
          These sign in with an access token instead. Create one below, then paste it where your
          Claude asks for the Hub&apos;s token. Treat it like a password — anyone with it can act as
          you.
        </p>

        {freshToken && (
          <div className="mb-4 rounded-xl border border-orange-500/40 bg-orange-500/10 p-4">
            <p className="text-sm text-orange-200 font-medium mb-2">
              Copy this token now — you won&apos;t be able to see it again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all text-xs bg-black/40 rounded-lg px-3 py-2 text-orange-100">
                {freshToken}
              </code>
              <button
                onClick={() => copy(freshToken)}
                className="flex-none px-3 py-2 bg-orange-500 hover:bg-orange-400 text-[#fff] rounded-lg text-sm font-medium transition-colors"
              >
                Copy
              </button>
            </div>
            <button
              onClick={() => setFreshToken(null)}
              className="mt-3 text-xs text-orange-200/80 hover:text-orange-100 underline"
            >
              I&apos;ve saved it — hide this
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. My laptop)"
            maxLength={60}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-orange-500"
          />
          <button
            onClick={create}
            disabled={creating}
            className="flex-none px-4 py-2 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-[#fff] rounded-lg text-sm font-medium transition-colors"
          >
            {creating ? 'Creating…' : 'Create access token'}
          </button>
        </div>
      </div>

      {/* Existing connections */}
      <div>
        <h3 className="text-sm font-semibold text-gray-200 mb-3">Your connections</h3>
        {data.tokens.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing connected yet.</p>
        ) : (
          <ul className="divide-y divide-gray-800 border border-gray-800 rounded-xl overflow-hidden">
            {data.tokens.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-gray-200 truncate">
                    {c.label || 'Untitled'}{' '}
                    {c.prefix && <span className="text-gray-500 font-mono text-xs">{c.prefix}</span>}
                  </div>
                  <div className="text-xs text-gray-500">
                    {c.kind === 'app' ? 'Claude app' : 'Access token'} · created{' '}
                    {shortDate(c.created_at)} · last used {shortDate(c.last_used_at)}
                  </div>
                </div>
                <button
                  onClick={() => revoke(c)}
                  className="flex-none px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded-lg text-xs font-medium transition-colors"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
