'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast, useConfirm } from '@/components/ui'
import {
  INTEGRATION_PROVIDERS,
  GROUP_LABELS,
  GROUP_ORDER,
  type IntegrationProvider,
  type IntegrationStatus,
  type ProviderKey,
} from '@/lib/integrations-catalog'

type StatusInfo = { status: IntegrationStatus; detail?: string }

const STATUS_META: Record<IntegrationStatus, { label: string; cls: string }> = {
  connected: { label: 'Connected', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
  action_needed: { label: 'Action needed', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/25' },
  not_connected: { label: 'Not connected', cls: 'bg-gray-700/60 text-gray-400 border-gray-600/50' },
  error: { label: 'Error', cls: 'bg-red-500/15 text-red-400 border-red-500/25' },
  coming_soon: { label: 'Coming soon', cls: 'bg-sky-500/10 text-sky-400 border-sky-500/25' },
}

type GoogleLsa = { connected: boolean; customerId: string | null; lsaEnabled: boolean }

export default function IntegrationsAdminPanel({
  statuses,
  webhookBase,
  onestepgpsOwnKey,
  googleLsa,
}: {
  statuses: Record<ProviderKey, StatusInfo>
  webhookBase: string
  onestepgpsOwnKey: boolean
  googleLsa: GoogleLsa
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="text-sm text-gray-400 mt-1 max-w-2xl">
          Connect your outside tools to Lynxedo. Every new lead source and business
          system is managed here — connect an account, or drop in a webhook, and your
          data flows into the Lead Tracker, contacts and beyond.
        </p>
      </div>

      {GROUP_ORDER.map(group => {
        const providers = INTEGRATION_PROVIDERS.filter(p => p.group === group)
        if (providers.length === 0) return null
        return (
          <section key={group} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-800">
              <h2 className="font-semibold text-lg">{GROUP_LABELS[group]}</h2>
            </div>
            <div className="divide-y divide-gray-800">
              {providers.map(p => (
                <IntegrationCard
                  key={p.key}
                  provider={p}
                  info={statuses[p.key] ?? { status: 'not_connected' }}
                  webhookBase={webhookBase}
                  hasOwnKey={p.key === 'onestepgps' ? onestepgpsOwnKey : false}
                  googleLsa={p.key === 'google' ? googleLsa : null}
                />
              ))}
            </div>
          </section>
        )
      })}

    </div>
  )
}

function StatusChip({ status, detail }: StatusInfo) {
  const meta = STATUS_META[status]
  return (
    <span className="flex items-center gap-2 flex-none">
      <span className={`text-[11px] border px-2 py-0.5 rounded-full whitespace-nowrap ${meta.cls}`}>{meta.label}</span>
      {detail && <span className="text-xs text-gray-500 hidden md:inline">{detail}</span>}
    </span>
  )
}

function IntegrationCard({
  provider,
  info,
  webhookBase,
  hasOwnKey,
  googleLsa,
}: {
  provider: IntegrationProvider
  info: StatusInfo
  webhookBase: string
  hasOwnKey: boolean
  googleLsa: GoogleLsa | null
}) {
  const router = useRouter()
  const toast = useToast()
  const confirmDialog = useConfirm()
  const [showSetup, setShowSetup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [lsaCustomerId, setLsaCustomerId] = useState(googleLsa?.customerId ?? '')

  const isConnected = info.status === 'connected'
  const isComingSoon = info.status === 'coming_soon'
  const angiUrl = `${webhookBase}/api/webhooks/angi`

  async function handleDisconnect() {
    if (!provider.disconnectHref) return
    const ok = await confirmDialog({
      message: `Disconnect ${provider.name}? Features that rely on it will stop working until you reconnect.`,
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch(provider.disconnectHref, { method: 'POST' })
      if (!res.ok) throw new Error()
      toast.success(`${provider.name} disconnected`)
      router.refresh()
    } catch {
      toast.error(`Couldn't disconnect ${provider.name}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveKey() {
    if (!apiKey.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/integrations/onestepgps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', api_key: apiKey.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save the key')
      toast.success(`${provider.name} connected`)
      setApiKey('')
      setShowSetup(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the key')
    } finally {
      setBusy(false)
    }
  }

  async function handleClearKey() {
    const ok = await confirmDialog({
      message: `Remove your ${provider.name} key? Your fleet map will stop working until you enter a key again.`,
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/integrations/onestepgps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear' }),
      })
      if (!res.ok) throw new Error()
      toast.success('Key removed')
      router.refresh()
    } catch {
      toast.error('Could not remove the key')
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveLsa() {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/integrations/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: lsaCustomerId.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save')
      toast.success('Local Services account saved')
      setShowSetup(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success('Copied'),
      () => toast.error('Copy failed'),
    )
  }

  const btn = 'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap disabled:opacity-50'

  return (
    <div className="px-6 py-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium text-sm">{provider.name}</div>
          <div className="text-sm text-gray-500 mt-0.5 max-w-xl">{provider.blurb}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <StatusChip {...info} />

          {/* Connect (OAuth start) — when a start route exists and we're not connected */}
          {!isComingSoon && provider.connectHref && !isConnected && (
            <a href={provider.connectHref} className={`${btn} bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border-blue-600/30`}>
              Connect
            </a>
          )}

          {/* Disconnect — when connected and a disconnect route exists */}
          {isConnected && provider.disconnectHref && (
            <button onClick={handleDisconnect} disabled={busy} className={`${btn} bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700`}>
              {busy ? 'Working…' : 'Disconnect'}
            </button>
          )}

          {/* Manage — deep link to the module that owns the detailed editor */}
          {!isComingSoon && provider.manageHref && (
            <Link href={provider.manageHref} className={`${btn} bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700`}>
              {provider.manageLabel ?? 'Manage'}
            </Link>
          )}

          {/* Webhook providers — reveal setup instructions */}
          {provider.model === 'webhook' && (
            <button onClick={() => setShowSetup(v => !v)} className={`${btn} bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700`}>
              {showSetup ? 'Hide setup' : 'Setup'}
            </button>
          )}

          {/* API-key providers — reveal the key form */}
          {provider.model === 'apikey' && (
            <button onClick={() => setShowSetup(v => !v)} className={`${btn} bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border-blue-600/30`}>
              {showSetup ? 'Close' : hasOwnKey ? 'Manage key' : 'Enter key'}
            </button>
          )}

          {/* Google — reveal the Local Services lead-poll config (once connected) */}
          {provider.key === 'google' && isConnected && (
            <button onClick={() => setShowSetup(v => !v)} className={`${btn} bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700`}>
              {showSetup ? 'Close' : 'Local Services'}
            </button>
          )}
        </div>
      </div>

      {/* Angi (webhook) setup detail */}
      {provider.key === 'angi' && showSetup && (
        <div className="mt-3 p-4 bg-gray-800/50 border border-gray-700 rounded-xl space-y-3">
          <div>
            <div className="text-xs text-gray-400 mb-1">Your Angi lead webhook URL</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200">{angiUrl}</code>
              <button onClick={() => copy(angiUrl)} className={`${btn} bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700`}>Copy</button>
            </div>
          </div>
          <ol className="list-decimal list-inside text-xs text-gray-400 space-y-1">
            <li>In your Angi account, add a lead / CRM integration and paste this URL.</li>
            <li>Email <span className="text-gray-200">crmintegrations@angi.com</span> with your Angi account (SPID) to turn on delivery.</li>
            <li>New Angi leads then land in the Lead Tracker automatically.</li>
          </ol>
          <p className="text-[11px] text-gray-500">
            Leads are authenticated with a secret key managed by Lynxedo. Per-account keys you generate
            yourself are coming with the next update.
          </p>
        </div>
      )}

      {/* API-key (e.g. OneStepGPS) setup detail */}
      {provider.model === 'apikey' && showSetup && (
        <div className="mt-3 p-4 bg-gray-800/50 border border-gray-700 rounded-xl space-y-3">
          <div>
            <div className="text-xs text-gray-400 mb-1">Your {provider.name} API key</div>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={hasOwnKey ? 'Enter a new key to replace the saved one' : 'Paste your API key'}
                className="flex-1 min-w-0 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
              <button onClick={handleSaveKey} disabled={busy || !apiKey.trim()} className={`${btn} bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border-blue-600/30`}>
                {busy ? 'Checking…' : 'Save'}
              </button>
            </div>
          </div>
          {hasOwnKey && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-emerald-400">Your key is saved and in use.</span>
              <button onClick={handleClearKey} disabled={busy} className={`${btn} bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700`}>Remove key</button>
            </div>
          )}
          <p className="text-[11px] text-gray-500">Find your API key in OneStepGPS under your account settings. We verify it with OneStepGPS before saving.</p>
        </div>
      )}

      {/* Google — Local Services (LSA) lead-poll config */}
      {provider.key === 'google' && isConnected && showSetup && (
        <div className="mt-3 p-4 bg-gray-800/50 border border-gray-700 rounded-xl space-y-3">
          <div>
            <div className="text-xs text-gray-400 mb-1">Google Local Services account ID</div>
            <div className="flex items-center gap-2">
              <input
                value={lsaCustomerId}
                onChange={e => setLsaCustomerId(e.target.value)}
                placeholder="e.g. 123-456-7890"
                className="flex-1 min-w-0 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
              <button onClick={handleSaveLsa} disabled={busy} className={`${btn} bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border-blue-600/30`}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
          <p className="text-[11px] text-gray-500">
            The 10-digit ID of the Google Ads / Local Services account to pull leads from. New Local Services Ads
            leads then land in the Lead Tracker automatically, checked every few minutes.
            {googleLsa?.customerId ? ` Currently pulling from ${googleLsa.customerId}.` : ''}
          </p>
        </div>
      )}
    </div>
  )
}
