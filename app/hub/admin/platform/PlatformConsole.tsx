'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useToast } from '@/components/ui'
import type { BillingCatalogFeature, BillingMode, TenantSummary, SubscriptionStatus } from '@/lib/billing/types'

// Admin → Platform (super-admin, gated on is_platform_admin). Two tabs:
//   • Pricing  — the master price-sheet editor over billing_catalog. Each field
//                auto-saves via PATCH /api/platform/pricing (debounced for
//                text/number, immediate for toggles), matching the app's admin
//                auto-save convention.
//   • Tenants  — a read-only billing snapshot of every tenant company.
// feature_key, is_base, and every stripe_* id are NOT editable here (see the
// backend allowlist) — pricing is placeholders until Stripe wiring (M2).

const CATEGORY_ORDER = ['core', 'communication', 'marketing', 'operations', 'financial'] as const
const CATEGORY_LABEL: Record<string, string> = {
  core: 'Core',
  communication: 'Communication',
  marketing: 'Marketing',
  operations: 'Operations',
  financial: 'Financial',
}

type SaveResult = { ok: true } | { ok: false; error: string }
type SaveFn = (featureKey: string, patch: Record<string, unknown>) => Promise<SaveResult>

// ── money helpers (the catalog stores cents; the editor works in dollars) ──
function centsToDollars(cents: number | null | undefined): string {
  return cents == null ? '' : (cents / 100).toFixed(2)
}
function dollarsToCents(str: string): number | null {
  const t = str.trim()
  if (!t) return null
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PlatformConsole({
  features: initialFeatures,
  tenants,
  mode,
}: {
  features: BillingCatalogFeature[]
  tenants: TenantSummary[]
  mode: BillingMode
}) {
  const [tab, setTab] = useState<'pricing' | 'tenants'>('pricing')
  const [features, setFeatures] = useState<BillingCatalogFeature[]>(initialFeatures)

  // One shared save path for the pricing editor. Sends { feature_key, ...patch };
  // on success it folds the returned row back into local state so derived UI (the
  // price de-emphasis, etc.) stays in sync.
  const savePatch: SaveFn = async (featureKey, patch) => {
    const res = await fetch('/api/platform/pricing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature_key: featureKey, ...patch }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      return { ok: false, error: j.error || 'Could not save.' }
    }
    const { feature } = await res.json()
    setFeatures((prev) => prev.map((f) => (f.feature_key === featureKey ? { ...f, ...feature } : f)))
    return { ok: true }
  }

  const baseFeatures = features.filter((f) => f.is_base)
  const addOns = features.filter((f) => !f.is_base)
  const known = new Set<string>(CATEGORY_ORDER)
  const otherCats = Array.from(new Set(addOns.map((f) => f.category).filter((c) => !known.has(c))))

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Platform</h1>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            mode === 'live'
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-amber-500/15 text-amber-300'
          }`}
          title={`Stripe billing mode for this environment: ${mode}`}
        >
          {mode} mode
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/10">
        <TabButton active={tab === 'pricing'} onClick={() => setTab('pricing')}>
          Pricing
        </TabButton>
        <TabButton active={tab === 'tenants'} onClick={() => setTab('tenants')}>
          Tenants
        </TabButton>
      </div>

      {tab === 'pricing' ? (
        <div className="space-y-8">
          <p className="text-sm text-gray-400">
            The master price sheet. Every price here is a <span className="text-gray-200">placeholder</span> until you
            set it — nothing is charged and no Stripe products are created until the billing wiring step (M2). Changes
            auto-save.
          </p>

          {/* Base subscription */}
          <PricingGroup title="Base subscription">
            {baseFeatures.length === 0 ? (
              <EmptyRow>No base feature defined yet.</EmptyRow>
            ) : (
              baseFeatures.map((f) => <FeatureRow key={f.feature_key} feature={f} onSave={savePatch} />)
            )}
          </PricingGroup>

          {/* Add-ons by category */}
          {CATEGORY_ORDER.map((cat) => {
            const rows = addOns.filter((f) => f.category === cat)
            if (rows.length === 0) return null
            return (
              <PricingGroup key={cat} title={CATEGORY_LABEL[cat]}>
                {rows.map((f) => (
                  <FeatureRow key={f.feature_key} feature={f} onSave={savePatch} />
                ))}
              </PricingGroup>
            )
          })}

          {/* Anything with an unexpected category still shows up */}
          {otherCats.map((cat) => (
            <PricingGroup key={cat} title={cat || 'Uncategorized'}>
              {addOns
                .filter((f) => f.category === cat)
                .map((f) => (
                  <FeatureRow key={f.feature_key} feature={f} onSave={savePatch} />
                ))}
            </PricingGroup>
          ))}
        </div>
      ) : (
        <TenantsTable tenants={tenants} />
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-b-2 border-sky-400 text-white'
          : 'border-b-2 border-transparent text-gray-400 hover:text-gray-200'
      }`}
    >
      {children}
    </button>
  )
}

function PricingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-gray-200">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="text-sm text-gray-500">{children}</p>
}

function FeatureRow({ feature, onSave }: { feature: BillingCatalogFeature; onSave: SaveFn }) {
  const toast = useToast()
  const [label, setLabel] = useState(feature.label)
  const [price, setPrice] = useState(centsToDollars(feature.default_price_cents))
  const [cost, setCost] = useState(centsToDollars(feature.cost_basis_cents))
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(
    () => () => {
      Object.values(timers.current).forEach((t) => clearTimeout(t))
      if (savedTimer.current) clearTimeout(savedTimer.current)
    },
    [],
  )

  // Base fee is always charged; only a true add-on that is folded into the base
  // has its price de-emphasized.
  const dimPrice = !feature.is_base && feature.included_in_base

  async function runSave(patch: Record<string, unknown>, revert?: () => void) {
    if (savedTimer.current) clearTimeout(savedTimer.current)
    setStatus('saving')
    const res = await onSave(feature.feature_key, patch)
    if (res.ok) {
      setStatus('saved')
      savedTimer.current = setTimeout(() => setStatus('idle'), 1500)
    } else {
      setStatus('error')
      toast.error(res.error)
      revert?.()
    }
  }

  function scheduleSave(field: string, patch: Record<string, unknown>, revert: () => void) {
    if (timers.current[field]) clearTimeout(timers.current[field])
    timers.current[field] = setTimeout(() => {
      void runSave(patch, revert)
    }, 600)
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* Label + key */}
        <div className="min-w-[180px] flex-1">
          <input
            value={label}
            onChange={(e) => {
              setLabel(e.target.value)
              scheduleSave('label', { label: e.target.value.trim() }, () => setLabel(feature.label))
            }}
            className="w-full rounded-md bg-transparent text-sm font-semibold text-white outline-none focus:bg-gray-900 focus:px-2 focus:py-1"
          />
          <code className="mt-0.5 block text-[11px] text-gray-500">{feature.feature_key}</code>
        </div>

        {/* Included in base (not shown for the base row itself) */}
        {!feature.is_base && (
          <Toggle
            label="Included in base"
            checked={feature.included_in_base}
            onChange={(v) => runSave({ included_in_base: v })}
          />
        )}

        {/* Price */}
        <MoneyField
          label="Price"
          value={price}
          dim={dimPrice}
          title={dimPrice ? 'Included in base — not charged separately' : undefined}
          onChange={(v) => {
            setPrice(v)
            scheduleSave('price', { default_price_cents: dollarsToCents(v) ?? 0 }, () =>
              setPrice(centsToDollars(feature.default_price_cents)),
            )
          }}
        />

        {/* Cost basis (nullable) */}
        <MoneyField
          label="Cost basis"
          value={cost}
          placeholder="—"
          onChange={(v) => {
            setCost(v)
            scheduleSave('cost', { cost_basis_cents: dollarsToCents(v) }, () =>
              setCost(centsToDollars(feature.cost_basis_cents)),
            )
          }}
        />

        {/* Active */}
        <Toggle label="Active" checked={feature.active} onChange={(v) => runSave({ active: v })} />

        {/* Status */}
        <span className="w-14 text-right text-[11px]">
          {status === 'saving' && <span className="text-gray-500">Saving…</span>}
          {status === 'saved' && <span className="text-emerald-400">Saved</span>}
          {status === 'error' && <span className="text-red-400">Error</span>}
        </span>
      </div>
    </div>
  )
}

function MoneyField({
  label,
  value,
  onChange,
  dim,
  title,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  dim?: boolean
  title?: string
  placeholder?: string
}) {
  return (
    <label className={`text-[11px] text-gray-400 ${dim ? 'opacity-40' : ''}`} title={title}>
      {label}
      <div className="mt-1 flex items-center rounded-lg border border-white/10 bg-gray-900 px-2">
        <span className="text-sm text-gray-500">$</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          placeholder={placeholder}
          className="w-20 bg-transparent px-1 py-2 text-sm text-white outline-none placeholder:text-gray-600"
        />
      </div>
    </label>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-300">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-sky-500' : 'bg-gray-600'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </button>
      {label}
    </label>
  )
}

function TenantsTable({ tenants }: { tenants: TenantSummary[] }) {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 font-medium">Company</th>
              <th className="px-3 py-2 font-medium">Subdomain</th>
              <th className="px-3 py-2 font-medium">Active</th>
              <th className="px-3 py-2 font-medium">Subscription</th>
              <th className="px-3 py-2 font-medium">Trial ends</th>
              <th className="px-3 py-2 text-right font-medium">Modules</th>
            </tr>
          </thead>
          <tbody>
            {tenants.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-gray-500">
                  No tenants yet.
                </td>
              </tr>
            ) : (
              tenants.map((t) => (
                <tr key={t.company_id} className="border-b border-white/5 last:border-0">
                  <td className="px-3 py-2 text-gray-200">{t.name}</td>
                  <td className="px-3 py-2 text-gray-400">
                    {t.subdomain_slug ? (
                      <code className="text-xs">{t.subdomain_slug}</code>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {t.is_active ? (
                      <span className="text-emerald-400">Active</span>
                    ) : (
                      <span className="text-gray-500">Inactive</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {t.subscription ? (
                      <StatusPill status={t.subscription.status} />
                    ) : (
                      <span className="italic text-gray-600">No billing yet</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-400">{fmtDate(t.subscription?.trial_ends_at)}</td>
                  <td className="px-3 py-2 text-right text-gray-200">{t.active_module_count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        Companies with no subscription row are fully entitled — billing gating fails open — until you put them on a
        plan.
      </p>
    </div>
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
