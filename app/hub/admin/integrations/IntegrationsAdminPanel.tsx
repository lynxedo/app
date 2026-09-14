'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast, useConfirm } from '@/components/ui'
import HubApiKeysSection from './HubApiKeysSection'
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

/** How current the Gusto payroll import is. See the note where it is loaded. */
type PayrollState = { through: string | null; clockThrough: string | null; lagDays: number | null }

/** Days behind the timeclock past which the import has probably stopped rather than
 *  merely lagged. Kept identical to PAYROLL_LAG_ALARM_DAYS in the Crew widgets on
 *  purpose — two places that disagree about "late" is worse than either threshold. */
const PAYROLL_LAG_ALARM_DAYS = 14

function shortDate(d: string | null): string {
  if (!d) return '—'
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

export default function IntegrationsAdminPanel({
  statuses,
  webhookBase,
  ownKeys,
  googleLsa,
  payroll,
}: {
  statuses: Record<ProviderKey, StatusInfo>
  webhookBase: string
  // Which API-key providers have a per-company key saved (OneStepGPS, VoiceDrop…).
  ownKeys: Partial<Record<ProviderKey, boolean>>
  googleLsa: GoogleLsa
  payroll: PayrollState
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
                  hasOwnKey={ownKeys[p.key] ?? false}
                  googleLsa={p.key === 'google' ? googleLsa : null}
                  payroll={p.key === 'gusto' ? payroll : null}
                />
              ))}
            </div>
          </section>
        )
      })}

      {/* Inbound automation keys — the reverse direction from the provider cards
          above (an outside service pushing INTO the Hub). Kept as its own clearly
          separated block, not mixed into the connect cards. */}
      <HubApiKeysSection />
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
  payroll,
}: {
  provider: IntegrationProvider
  info: StatusInfo
  webhookBase: string
  hasOwnKey: boolean
  googleLsa: GoogleLsa | null
  payroll: PayrollState | null
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
      const res = await fetch(`/api/admin/integrations/${provider.key}`, {
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
      message: `Remove your ${provider.name} key? Features that rely on it will stop working until you enter a key again.`,
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/integrations/${provider.key}`, {
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

  /**
   * Pull processed payroll runs from Gusto into the report tables.
   *
   * ⚠⚠ THIS BUTTON DID NOT EXIST until 2026-09-14, though the sync route's own header
   * comment had claimed for weeks that it did. The endpoint was reachable only by a
   * cron secret, and no cron was ever wired, so payroll was refreshed exactly twice —
   * both times by hand — and sat four weeks stale in between with no symptom anywhere
   * except Crew & Labor cards quietly going blank.
   */
  async function handleSyncPayroll() {
    setBusy(true)
    try {
      /* Re-import from a fortnight before the last run rather than from the start of
       * time. Gusto is one HTTP call per payroll, so "everything" is ~40 round trips
       * for the two or three weeks that can actually have changed — and the overlap
       * still catches a correction or an off-cycle run added to an earlier week. The
       * upsert is keyed on the payroll id, so re-importing a week is a no-op. */
      const from = payroll?.through
        ? new Date(Date.parse(`${payroll.through}T12:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10)
        : undefined
      const res = await fetch('/api/admin/payroll/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(from ? { start: from } : {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not sync payroll')
      const unmatched = Number(data.unmatched_people ?? 0)
      toast.success(
        `Imported ${data.imported ?? 0} pay record${data.imported === 1 ? '' : 's'}`
        + (unmatched ? ` · ${unmatched} not matched to anyone on the roster` : ''))
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not sync payroll')
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

          {/* Connect / Reconnect (OAuth start) — always available when a start route
              exists. Showing "Reconnect" while connected is essential: a token can go
              dead (expired/revoked refresh token) while the row still reads "connected",
              and without this the only button was Disconnect — leaving no way to re-auth. */}
          {!isComingSoon && provider.connectHref && (
            <a href={provider.connectHref} className={`${btn} ${isConnected ? 'bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700' : 'bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border-blue-600/30'}`}>
              {isConnected ? 'Reconnect' : 'Connect'}
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

          {/* Gusto — pull processed payroll in. Shown even while disconnected, but
              disabled: hiding it would take the one visible cue that payroll is a
              thing this integration feeds, and the tooltip says what is missing. */}
          {provider.key === 'gusto' && (
            <button
              onClick={handleSyncPayroll}
              disabled={busy || !isConnected}
              title={isConnected ? 'Import processed payroll runs from Gusto' : 'Connect Gusto first'}
              className={`${btn} bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border-blue-600/30`}
            >
              {busy ? 'Syncing…' : 'Sync payroll'}
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

      {/* Gusto — how current the payroll import is. Reads our own tables, so it still
          answers while Gusto is disconnected, which is precisely when it matters. */}
      {provider.key === 'gusto' && payroll && (
        <div className="mt-2 text-xs">
          {!payroll.through ? (
            <span className="text-gray-500">No payroll imported yet — Crew &amp; Labor reports need this.</span>
          ) : payroll.lagDays !== null && payroll.lagDays >= PAYROLL_LAG_ALARM_DAYS ? (
            <span className="text-amber-400">
              ⚠ Payroll imported through {shortDate(payroll.through)} — {payroll.lagDays} days behind the
              timeclock, which has hours through {shortDate(payroll.clockThrough)}. Crew &amp; Labor
              figures stop at the payroll date until this is synced.
            </span>
          ) : (
            <span className="text-gray-500">
              Payroll imported through {shortDate(payroll.through)}
              {payroll.lagDays ? ` · ${payroll.lagDays} day${payroll.lagDays === 1 ? '' : 's'} behind the timeclock` : ' · up to date'}
            </span>
          )}
        </div>
      )}

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
          <p className="text-[11px] text-gray-500">Find your API key in your {provider.name} account settings. We verify it with {provider.name} before saving.</p>
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
