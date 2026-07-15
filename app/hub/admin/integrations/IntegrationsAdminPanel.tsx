'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast, useConfirm } from '@/components/ui'
import {
  INTEGRATION_PROVIDERS,
  PLATFORM_SERVICES,
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

export default function IntegrationsAdminPanel({
  statuses,
  webhookBase,
}: {
  statuses: Record<ProviderKey, StatusInfo>
  webhookBase: string
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
                />
              ))}
            </div>
          </section>
        )
      })}

      {/* Platform services — Lynxedo's own keys, informational only */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-800">
          <h2 className="font-semibold text-lg">Platform services</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Included with Lynxedo and managed for you — nothing to set up.
          </p>
        </div>
        <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          {PLATFORM_SERVICES.map(s => (
            <div key={s.name} className="flex items-center gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-none" />
              <div className="min-w-0">
                <span className="text-sm text-gray-200">{s.name}</span>
                <span className="text-xs text-gray-500"> · {s.blurb}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
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
}: {
  provider: IntegrationProvider
  info: StatusInfo
  webhookBase: string
}) {
  const router = useRouter()
  const toast = useToast()
  const confirmDialog = useConfirm()
  const [showSetup, setShowSetup] = useState(false)
  const [busy, setBusy] = useState(false)

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
    </div>
  )
}
