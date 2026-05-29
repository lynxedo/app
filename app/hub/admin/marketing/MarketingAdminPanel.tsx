'use client'

import { useState } from 'react'

type SocialAccount = {
  id: string
  platform: 'facebook' | 'instagram' | 'google_business'
  account_name: string
  external_id: string
  ig_user_id: string | null
  active: boolean
  token_expires_at: string | null
  created_at: string
}

const PLATFORM_LABEL: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  google_business: 'Google Business',
}

const PLATFORM_COLOR: Record<string, string> = {
  facebook: 'text-blue-400 bg-blue-500/10',
  instagram: 'text-pink-400 bg-pink-500/10',
  google_business: 'text-green-400 bg-green-500/10',
}

function formatExpiry(ts: string | null): { text: string; daysLeft: number | null } {
  if (!ts) return { text: 'Never expires', daysLeft: null }
  const d = new Date(ts)
  const now = new Date()
  const days = Math.ceil((d.getTime() - now.getTime()) / 86400000)
  if (days < 0) return { text: 'Expired', daysLeft: days }
  if (days === 0) return { text: 'Expires today', daysLeft: 0 }
  if (days <= 7) return { text: `Expires in ${days}d`, daysLeft: days }
  return {
    text: `Expires ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} (${days}d)`,
    daysLeft: days,
  }
}

export default function MarketingAdminPanel({
  initialAccounts,
  metaConfigured,
  metaConnectedCount,
  metaError,
  googleConfigured,
  googleConnected,
  googleError,
}: {
  initialAccounts: SocialAccount[]
  metaConfigured: boolean
  metaConnectedCount: number | null
  metaError: string | null
  googleConfigured: boolean
  googleConnected: boolean
  googleError: string | null
}) {
  const [accounts, setAccounts] = useState<SocialAccount[]>(initialAccounts)
  const [connecting, setConnecting] = useState(false)
  const [connectErr, setConnectErr] = useState('')
  const [connectingGoogle, setConnectingGoogle] = useState(false)
  const [connectGoogleErr, setConnectGoogleErr] = useState('')
  const initialBanner = metaConnectedCount !== null
    ? { text: `Connected ${metaConnectedCount} Facebook page${metaConnectedCount !== 1 ? 's' : ''}. Tokens will auto-renew before expiry.`, kind: 'success' as const }
    : metaError
    ? { text: `Meta connection error: ${metaError}`, kind: 'error' as const }
    : googleConnected
    ? { text: 'Google Business Profile connected. Posts will publish via the same scheduler as Facebook.', kind: 'success' as const }
    : googleError
    ? { text: `Google connection error: ${googleError}`, kind: 'error' as const }
    : null
  const [banner, setBanner] = useState<{ text: string; kind: 'success' | 'error' } | null>(initialBanner)

  // Per-account refresh state
  const [refreshOpen, setRefreshOpen] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshErr, setRefreshErr] = useState('')

  async function handleConnectFacebook() {
    setConnecting(true)
    setConnectErr('')
    try {
      const res = await fetch('/api/admin/social-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'oauth_url' }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        setConnectErr(data.error ?? 'Failed to get OAuth URL')
        setConnecting(false)
        return
      }
      window.location.href = data.url
    } catch {
      setConnectErr('Network error')
      setConnecting(false)
    }
  }

  async function handleConnectGoogle() {
    setConnectingGoogle(true)
    setConnectGoogleErr('')
    try {
      const res = await fetch('/api/admin/social-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'oauth_url_google' }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        setConnectGoogleErr(data.error ?? 'Failed to get OAuth URL')
        setConnectingGoogle(false)
        return
      }
      window.location.href = data.url
    } catch {
      setConnectGoogleErr('Network error')
      setConnectingGoogle(false)
    }
  }

  async function toggleActive(accountId: string, active: boolean) {
    const res = await fetch(`/api/admin/social-accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    })
    if (res.ok) {
      setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, active } : a))
    }
  }

  async function deleteAccount(accountId: string) {
    if (!confirm('Remove this social account? Scheduled posts using it will fail.')) return
    const res = await fetch(`/api/admin/social-accounts/${accountId}`, { method: 'DELETE' })
    if (res.ok) {
      setAccounts(prev => prev.filter(a => a.id !== accountId))
    }
  }

  async function handleRefreshToken(accountId: string) {
    if (!refreshToken.trim()) { setRefreshErr('Paste your User Access Token first'); return }
    setRefreshing(true)
    setRefreshErr('')
    try {
      const res = await fetch(`/api/admin/social-accounts/${accountId}/refresh-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userToken: refreshToken.trim() }),
      })
      const data = await res.json() as { account?: SocialAccount; error?: string }
      if (!res.ok || !data.account) {
        setRefreshErr(data.error ?? 'Refresh failed')
        setRefreshing(false)
        return
      }
      setAccounts(prev => prev.map(a => a.id === accountId ? data.account! : a))
      setRefreshOpen(null)
      setRefreshToken('')
      setBanner({ text: 'Token refreshed successfully — good for another 60 days.', kind: 'success' })
    } catch {
      setRefreshErr('Network error')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Marketing Admin</h1>
        <p className="text-sm text-white/50 mt-1">
          Connect Facebook, Instagram, and Google Business Profile to enable social posting from the Marketing section.
        </p>
      </div>

      {banner && (
        <div className={`rounded-lg px-4 py-3 text-sm ${
          banner.kind === 'error' ? 'bg-red-500/10 text-red-300 border border-red-500/20' : 'bg-green-500/10 text-green-300 border border-green-500/20'
        }`}>
          {banner.text}
          <button onClick={() => setBanner(null)} className="ml-3 text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Connected accounts */}
      <div className="bg-gray-900 rounded-xl border border-gray-800">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Connected Accounts</h2>
          <span className="text-xs text-white/40">{accounts.length} account{accounts.length !== 1 ? 's' : ''}</span>
        </div>

        {accounts.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-white/40">
            No accounts connected yet. Use the button below to link your Facebook pages.
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {accounts.map(account => {
              const { text: expiryText, daysLeft } = formatExpiry(account.token_expires_at)
              const expired = daysLeft !== null && daysLeft < 0
              const expiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 14
              const isRefreshOpen = refreshOpen === account.id
              return (
                <div key={account.id}>
                  <div className="px-5 py-3 flex items-center gap-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PLATFORM_COLOR[account.platform] ?? 'text-gray-400 bg-gray-700'}`}>
                      {PLATFORM_LABEL[account.platform] ?? account.platform}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white font-medium truncate">{account.account_name}</div>
                      <div className={`text-xs mt-0.5 ${expired ? 'text-red-400' : expiringSoon ? 'text-amber-400' : 'text-white/40'}`}>
                        {expiryText}
                        {account.ig_user_id && (
                          <span className="ml-2 text-pink-400">· IG linked</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {account.platform !== 'google_business' && (
                        <button
                          onClick={() => {
                            setRefreshOpen(isRefreshOpen ? null : account.id)
                            setRefreshToken('')
                            setRefreshErr('')
                          }}
                          className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                            isRefreshOpen
                              ? 'border-amber-600/40 text-amber-400 bg-amber-900/20'
                              : expiringSoon || expired
                              ? 'border-amber-600/40 text-amber-400 hover:bg-amber-900/20'
                              : 'border-gray-700 text-white/40 hover:text-amber-400 hover:border-amber-600/40'
                          }`}
                        >
                          ↻ Refresh
                        </button>
                      )}
                      <button
                        onClick={() => toggleActive(account.id, !account.active)}
                        className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                          account.active
                            ? 'border-green-600/40 text-green-400 hover:bg-red-900/30 hover:text-red-400 hover:border-red-600/40'
                            : 'border-gray-700 text-white/40 hover:bg-green-900/30 hover:text-green-400 hover:border-green-600/40'
                        }`}
                      >
                        {account.active ? 'Active' : 'Inactive'}
                      </button>
                      <button
                        onClick={() => deleteAccount(account.id)}
                        className="text-xs px-2.5 py-1 rounded-md border border-gray-700 text-white/40 hover:text-red-400 hover:border-red-600/40 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {/* Inline token refresh panel */}
                  {isRefreshOpen && (
                    <div className="mx-4 mb-4 rounded-lg bg-amber-500/5 border border-amber-500/20 p-4 space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-amber-300 mb-2">How to get a User Access Token</p>
                        <ol className="text-xs text-white/60 space-y-1 list-decimal list-inside">
                          <li>
                            Go to{' '}
                            <a
                              href="https://developers.facebook.com/tools/explorer"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 underline hover:text-blue-300"
                            >
                              developers.facebook.com/tools/explorer
                            </a>
                          </li>
                          <li>In the top-right dropdown, select your Lynxedo app</li>
                          <li>Click <strong className="text-white/80">Generate Access Token</strong> → approve permissions</li>
                          <li>Copy the token and paste it below</li>
                        </ol>
                      </div>
                      <textarea
                        value={refreshToken}
                        onChange={e => setRefreshToken(e.target.value)}
                        placeholder="Paste your User Access Token here…"
                        rows={3}
                        className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-white/30 focus:outline-none focus:border-amber-500/60 resize-none"
                      />
                      {refreshErr && <p className="text-xs text-red-400">{refreshErr}</p>}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleRefreshToken(account.id)}
                          disabled={refreshing || !refreshToken.trim()}
                          className="text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
                        >
                          {refreshing ? 'Refreshing…' : 'Refresh Token'}
                        </button>
                        <button
                          onClick={() => { setRefreshOpen(null); setRefreshToken(''); setRefreshErr('') }}
                          className="text-xs text-white/40 hover:text-white/70 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Auto Token Renewal */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-3">
        <div className="flex items-start gap-3">
          <span className="text-green-400 text-lg mt-0.5">⟳</span>
          <div>
            <h2 className="text-sm font-semibold text-white">Auto Token Renewal</h2>
            <p className="text-xs text-white/50 mt-1">
              Once the weekly cron is set up (see below), tokens renew automatically — no action needed. The system
              re-exchanges the stored token every Monday before it can expire. You only need to use the{' '}
              <strong className="text-white/70">↻ Refresh</strong> button above if the token actually expires (e.g., the
              cron was down for an extended period).
            </p>
          </div>
        </div>
      </div>

      {/* Connect button */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Connect Facebook Pages</h2>
          <p className="text-xs text-white/50 mt-1">
            Click below to authorize Lynxedo to post to your Facebook pages and linked Instagram accounts.
            You&apos;ll be redirected to Facebook to approve the connection.
          </p>
        </div>

        {!metaConfigured && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-xs text-amber-300">
            <strong>Setup required:</strong> Add <code className="font-mono">META_APP_ID</code> and <code className="font-mono">META_APP_SECRET</code> to the VPS
            environment file (<code className="font-mono">/opt/lynxedo/app/.env.local</code>), then rebuild.
          </div>
        )}

        {connectErr && (
          <div className="text-xs text-red-400">{connectErr}</div>
        )}

        <button
          onClick={handleConnectFacebook}
          disabled={!metaConfigured || connecting}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {connecting ? 'Redirecting to Facebook…' : accounts.length > 0 ? 'Reconnect / Update Tokens' : 'Connect Facebook Accounts'}
        </button>

        <div className="text-xs text-white/30 space-y-1">
          <p>Permissions requested: Pages Manage Posts, Pages Read Engagement, Instagram Content Publish</p>
          <p>Tokens are long-lived (~60 days) and auto-renew weekly via cron.</p>
        </div>
      </div>

      {/* Google Business connect */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Connect Google Business Profile</h2>
          <p className="text-xs text-white/50 mt-1">
            Click below to authorize Lynxedo to post to your Google Business Profile. Posts appear in Google Search
            and Maps results for local searches like &ldquo;lawn care The Woodlands.&rdquo;
          </p>
          <p className="text-xs text-amber-300/80 mt-2">
            ⚠ Google Business posts expire and disappear from your profile after 7 days. Schedule new posts weekly to stay visible.
          </p>
        </div>

        {!googleConfigured && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-xs text-amber-300">
            <strong>Setup required:</strong> Add <code className="font-mono">GOOGLE_CLIENT_ID</code> and <code className="font-mono">GOOGLE_CLIENT_SECRET</code> to the VPS
            environment file (<code className="font-mono">/opt/lynxedo/app/.env.local</code>), then rebuild.
          </div>
        )}

        {connectGoogleErr && (
          <div className="text-xs text-red-400">{connectGoogleErr}</div>
        )}

        <button
          onClick={handleConnectGoogle}
          disabled={!googleConfigured || connectingGoogle}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {connectingGoogle
            ? 'Redirecting to Google…'
            : accounts.some(a => a.platform === 'google_business')
            ? 'Reconnect / Update Google Business'
            : 'Connect Google Business'}
        </button>

        <div className="text-xs text-white/30 space-y-1">
          <p>Permission requested: Manage your Business Profile (<code className="font-mono">business.manage</code>)</p>
          <p>Google issues a refresh token; access tokens are short-lived (~1h) and re-fetched at each publish.</p>
        </div>
      </div>

      {/* Cron setup */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-white">Cron Setup (one-time)</h2>
        <p className="text-xs text-white/50">
          Add both lines to the VPS crontab (<code className="font-mono">crontab -e</code>).
          The first publishes scheduled posts every minute. The second auto-renews tokens every Monday.
        </p>
        <div className="space-y-2">
          <div>
            <p className="text-xs text-white/40 mb-1">Post delivery (every minute):</p>
            <pre className="text-xs font-mono bg-gray-950 text-green-300 px-3 py-2 rounded-lg overflow-x-auto whitespace-pre-wrap">
              {`* * * * * curl -s -X POST https://lynxedo.com/api/hub/social/deliver -H "x-cron-secret: $CRON_SECRET" >/dev/null 2>&1`}
            </pre>
          </div>
          <div>
            <p className="text-xs text-white/40 mb-1">Token auto-renewal (every Monday 9am UTC):</p>
            <pre className="text-xs font-mono bg-gray-950 text-green-300 px-3 py-2 rounded-lg overflow-x-auto whitespace-pre-wrap">
              {`0 9 * * 1 curl -s -X POST https://lynxedo.com/api/hub/social/refresh-tokens -H "x-cron-secret: $CRON_SECRET" >/dev/null 2>&1`}
            </pre>
          </div>
        </div>
        <p className="text-xs text-white/30">
          Replace <code className="font-mono">$CRON_SECRET</code> with the actual value from <code className="font-mono">.env.local</code>.
        </p>
      </div>
    </div>
  )
}
