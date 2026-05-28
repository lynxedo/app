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

function formatExpiry(ts: string | null): string {
  if (!ts) return 'Never expires'
  const d = new Date(ts)
  const now = new Date()
  const days = Math.ceil((d.getTime() - now.getTime()) / 86400000)
  if (days < 0) return 'Expired'
  if (days === 0) return 'Expires today'
  if (days <= 7) return `Expires in ${days}d`
  return `Expires ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

export default function MarketingAdminPanel({
  initialAccounts,
  metaConfigured,
  metaConnectedCount,
  metaError,
}: {
  initialAccounts: SocialAccount[]
  metaConfigured: boolean
  metaConnectedCount: number | null
  metaError: string | null
}) {
  const [accounts, setAccounts] = useState<SocialAccount[]>(initialAccounts)
  const [connecting, setConnecting] = useState(false)
  const [connectErr, setConnectErr] = useState('')
  const [banner, setBanner] = useState<string | null>(
    metaConnectedCount !== null
      ? `Connected ${metaConnectedCount} Facebook page${metaConnectedCount !== 1 ? 's' : ''}. Tokens will auto-reconnect before expiry.`
      : metaError
      ? `Meta connection error: ${metaError}`
      : null
  )

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

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Marketing Admin</h1>
        <p className="text-sm text-white/50 mt-1">
          Connect Facebook pages to enable social posting from the Marketing section.
        </p>
      </div>

      {banner && (
        <div className={`rounded-lg px-4 py-3 text-sm ${
          metaError ? 'bg-red-500/10 text-red-300 border border-red-500/20' : 'bg-green-500/10 text-green-300 border border-green-500/20'
        }`}>
          {banner}
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
              const expiryText = formatExpiry(account.token_expires_at)
              const expiring = account.token_expires_at && new Date(account.token_expires_at).getTime() - Date.now() < 7 * 86400000
              return (
                <div key={account.id} className="px-5 py-3 flex items-center gap-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PLATFORM_COLOR[account.platform] ?? 'text-gray-400 bg-gray-700'}`}>
                    {PLATFORM_LABEL[account.platform] ?? account.platform}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-medium truncate">{account.account_name}</div>
                    <div className={`text-xs mt-0.5 ${expiring ? 'text-amber-400' : 'text-white/40'}`}>
                      {expiryText}
                      {account.ig_user_id && (
                        <span className="ml-2 text-pink-400">· IG linked</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
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
              )
            })}
          </div>
        )}
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
          <p>Tokens are long-lived (~60 days). Reconnect before expiry to avoid posting failures.</p>
        </div>
      </div>

      {/* VPS cron reminder */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-2">
        <h2 className="text-sm font-semibold text-white">Cron Setup (one-time)</h2>
        <p className="text-xs text-white/50">
          Add this line to the VPS crontab (<code className="font-mono">crontab -e</code>) to enable automatic publishing of scheduled posts:
        </p>
        <pre className="text-xs font-mono bg-gray-950 text-green-300 px-3 py-2 rounded-lg overflow-x-auto whitespace-pre-wrap">
          {`* * * * * curl -s -X POST https://lynxedo.com/api/hub/social/deliver -H "x-cron-secret: $CRON_SECRET" >/dev/null 2>&1`}
        </pre>
        <p className="text-xs text-white/30">
          Replace <code className="font-mono">$CRON_SECRET</code> with the actual value from <code className="font-mono">.env.local</code>.
          Run every minute — same pattern as scheduled messages.
        </p>
      </div>
    </div>
  )
}
