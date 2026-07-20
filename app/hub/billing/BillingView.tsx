'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { useToast } from '@/components/ui'
import type {
  BillingCatalogFeature,
  BillingMode,
  CompanySubscription,
  SubscriptionStatus,
} from '@/lib/billing/types'

// Company-facing plan chooser + subscription status. Reuses the visual language of the
// platform console (dark cards, sky/emerald/amber accents, the same money + date
// helpers). Two side-effectful buttons:
//   • Subscribe / Update plan → POST /api/billing/checkout { feature_keys } → Stripe Checkout
//   • Manage billing          → POST /api/billing/portal → Stripe Customer Portal
// Both hand back a `url` we send the browser to; both surface backend errors via toast.

const CATEGORY_ORDER = ['core', 'communication', 'marketing', 'operations', 'financial'] as const
const CATEGORY_LABEL: Record<string, string> = {
  core: 'Core',
  communication: 'Communication',
  marketing: 'Marketing',
  operations: 'Operations',
  financial: 'Financial',
}

// ── money + date helpers (catalog stores cents) ──
function fmtMoney(cents: number | null | undefined): string {
  const n = (cents ?? 0) / 100
  return `$${n.toFixed(2)}`
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function BillingView({
  company,
  mode,
  subscription,
  subscribedKeys,
  features,
}: {
  company: { id: string; name: string }
  mode: BillingMode
  subscription: CompanySubscription | null
  subscribedKeys: string[]
  features: BillingCatalogFeature[]
}) {
  const toast = useToast()
  const searchParams = useSearchParams()

  const baseFeature = useMemo(() => features.find((f) => f.is_base) ?? null, [features])
  // Billable add-ons: not the base, not folded into the base, and currently active.
  const billableAddOns = useMemo(
    () => features.filter((f) => !f.is_base && !f.included_in_base && f.active),
    [features],
  )
  // Included-in-base modules (shown as a perk list, never charged separately).
  const includedModules = useMemo(
    () => features.filter((f) => !f.is_base && f.included_in_base && f.active),
    [features],
  )
  const billableKeySet = useMemo(
    () => new Set(billableAddOns.map((f) => f.feature_key)),
    [billableAddOns],
  )

  // Pre-check whatever the tenant already subscribes to (intersected with what's still
  // a billable add-on, so a since-retired/absorbed module doesn't linger as checked).
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(subscribedKeys.filter((k) => billableKeySet.has(k))),
  )
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)

  // One-time toast reflecting a return from Stripe Checkout.
  useEffect(() => {
    const c = searchParams.get('checkout')
    if (c === 'success') toast.success('Subscription updated.')
    else if (c === 'cancel') toast.info('Checkout canceled.')
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const basePriceCents = baseFeature?.default_price_cents ?? 0
  const modulesTotalCents = billableAddOns
    .filter((f) => checked.has(f.feature_key))
    .reduce((sum, f) => sum + (f.default_price_cents ?? 0), 0)
  const totalCents = basePriceCents + modulesTotalCents

  const status: SubscriptionStatus = subscription?.status ?? 'none'
  const hasPlan = subscription != null && status !== 'none'
  const canManageBilling = Boolean(subscription?.stripe_customer_id)

  async function handleSubscribe() {
    setCheckoutLoading(true)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_keys: Array.from(checked) }),
      })
      const j = await res.json().catch(() => ({} as { url?: string; missing?: string[]; error?: string }))
      if (!res.ok) {
        toast.error(j.error || 'Could not start checkout.')
        return
      }
      if (Array.isArray(j.missing) && j.missing.length > 0) {
        toast.info(`Some add-ons couldn't be added yet: ${j.missing.join(', ')}`)
      }
      if (j.url) {
        window.location.href = j.url
      } else {
        toast.error('No checkout link was returned. Billing may not be fully set up yet.')
      }
    } catch {
      toast.error('Could not start checkout. Please try again.')
    } finally {
      setCheckoutLoading(false)
    }
  }

  async function handleManageBilling() {
    setPortalLoading(true)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const j = await res.json().catch(() => ({} as { url?: string; error?: string }))
      if (!res.ok || !j.url) {
        toast.error(
          j.error === 'No billing customer yet'
            ? 'No billing is set up yet — subscribe first.'
            : j.error || 'Could not open the billing portal.',
        )
        return
      }
      window.location.href = j.url
    } catch {
      toast.error('Could not open the billing portal. Please try again.')
    } finally {
      setPortalLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Billing</h1>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            mode === 'live' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
          }`}
          title={`Stripe billing mode for this environment: ${mode}`}
        >
          {mode} mode
        </span>
      </div>

      {mode === 'test' && (
        <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Test mode — no real charges. Use Stripe test card 4242 4242 4242 4242, any future
          expiry/CVC.
        </p>
      )}

      {/* Current plan */}
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-200">Current plan</h2>
            <div className="flex items-center gap-2">
              {hasPlan ? (
                <StatusPill status={status} />
              ) : (
                <span className="rounded-full bg-gray-500/15 px-2 py-0.5 text-[11px] font-medium text-gray-300">
                  No plan yet
                </span>
              )}
            </div>
            {hasPlan && (
              <p className="text-xs text-gray-400">
                {status === 'trialing' && subscription?.trial_ends_at ? (
                  <>Trial ends {fmtDate(subscription.trial_ends_at)}</>
                ) : subscription?.cancel_at_period_end ? (
                  <>Cancels on {fmtDate(subscription?.current_period_end)}</>
                ) : (
                  <>Renews on {fmtDate(subscription?.current_period_end)}</>
                )}
              </p>
            )}
          </div>

          {canManageBilling && (
            <button
              type="button"
              onClick={handleManageBilling}
              disabled={portalLoading}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {portalLoading ? 'Opening…' : 'Manage billing'}
            </button>
          )}
        </div>
      </section>

      {/* Choose your plan */}
      <section className="space-y-6">
        <h2 className="text-sm font-semibold text-gray-200">Choose your plan</h2>

        {/* Base subscription — always included */}
        <PlanGroup title="Base subscription">
          {baseFeature ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-400/20 bg-sky-500/[0.06] p-3">
              <div className="min-w-[180px] flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{baseFeature.label}</span>
                  <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300">
                    Included
                  </span>
                </div>
                {baseFeature.description && (
                  <p className="mt-0.5 text-xs text-gray-400">{baseFeature.description}</p>
                )}
              </div>
              <div className="text-sm font-semibold text-white">
                {fmtMoney(baseFeature.default_price_cents)}
                <span className="text-xs font-normal text-gray-500">/mo</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No base plan configured yet.</p>
          )}
        </PlanGroup>

        {/* Billable add-ons, grouped by category */}
        {(() => {
          const known = new Set<string>(CATEGORY_ORDER)
          const extraCats = Array.from(
            new Set(billableAddOns.map((f) => f.category).filter((c) => !known.has(c))),
          )
          const orderedCats = [...CATEGORY_ORDER, ...extraCats]
          const anyAddOns = billableAddOns.length > 0
          if (!anyAddOns) {
            return (
              <PlanGroup title="Add-on modules">
                <p className="text-sm text-gray-500">No add-on modules are available right now.</p>
              </PlanGroup>
            )
          }
          return orderedCats.map((cat) => {
            const rows = billableAddOns.filter((f) => f.category === cat)
            if (rows.length === 0) return null
            return (
              <PlanGroup key={cat} title={CATEGORY_LABEL[cat] ?? cat ?? 'Other'}>
                {rows.map((f) => (
                  <ModuleRow
                    key={f.feature_key}
                    feature={f}
                    checked={checked.has(f.feature_key)}
                    onToggle={() => toggle(f.feature_key)}
                  />
                ))}
              </PlanGroup>
            )
          })
        })()}

        {/* Included-in-base perks */}
        {includedModules.length > 0 && (
          <PlanGroup title="Included in your base plan">
            <ul className="space-y-1.5">
              {includedModules.map((f) => (
                <li key={f.feature_key} className="flex items-center gap-2 text-sm text-gray-400">
                  <span className="text-emerald-400">✓</span>
                  <span className="text-gray-300">{f.label}</span>
                  {f.description && (
                    <span className="hidden text-xs text-gray-500 sm:inline">— {f.description}</span>
                  )}
                </li>
              ))}
            </ul>
          </PlanGroup>
        )}
      </section>

      {/* Total + subscribe */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500">Estimated monthly total</div>
          <div className="text-2xl font-bold text-white">
            {fmtMoney(totalCents)}
            <span className="text-sm font-normal text-gray-500">/mo</span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSubscribe}
          disabled={checkoutLoading}
          className="rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {checkoutLoading ? 'Starting…' : hasPlan ? 'Update plan' : 'Subscribe'}
        </button>
      </section>

      <p className="text-xs text-gray-500">
        Prices are set by the platform admin and may be placeholders until billing is fully
        configured.
      </p>
    </div>
  )
}

function PlanGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function ModuleRow({
  feature,
  checked,
  onToggle,
}: {
  feature: BillingCatalogFeature
  checked: boolean
  onToggle: () => void
}) {
  return (
    <label
      className={`flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-lg border p-3 transition-colors ${
        checked ? 'border-sky-400/30 bg-sky-500/[0.06]' : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex min-w-[180px] flex-1 items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-0.5 h-4 w-4 shrink-0 accent-sky-500"
        />
        <div>
          <div className="text-sm font-medium text-white">{feature.label}</div>
          {feature.description && (
            <p className="mt-0.5 text-xs text-gray-400">{feature.description}</p>
          )}
        </div>
      </div>
      <div className="text-sm font-semibold text-white">
        {fmtMoney(feature.default_price_cents)}
        <span className="text-xs font-normal text-gray-500">/mo</span>
      </div>
    </label>
  )
}

function StatusPill({ status }: { status: SubscriptionStatus }) {
  const styles: Record<SubscriptionStatus, string> = {
    none: 'bg-gray-500/15 text-gray-300',
    trialing: 'bg-amber-500/15 text-amber-300',
    active: 'bg-emerald-500/15 text-emerald-300',
    past_due: 'bg-red-500/15 text-red-300',
    canceled: 'bg-gray-500/15 text-gray-400',
    incomplete: 'bg-amber-500/15 text-amber-300',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[status]}`}>
      {status.replace('_', ' ')}
    </span>
  )
}
