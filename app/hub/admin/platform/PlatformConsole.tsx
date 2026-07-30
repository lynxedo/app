'use client'

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { useToast } from '@/components/ui'
import type { BillingCatalogFeature, BillingMode, TenantSummary, SubscriptionStatus } from '@/lib/billing/types'
import { WIRED_METER_EVENTS, isWiredMeter } from '@/lib/billing/wired-meters'
import { centsToDollarsPrecise, dollarsToCentsPrecise } from '@/lib/billing/money'

// ── local response types for the enriched Tenants tab (built against the M4 endpoints) ──
type TenantDetail = {
  company: { id: string; name: string; subdomain_slug: string | null; is_active: boolean }
  subscription: {
    status: SubscriptionStatus
    trial_ends_at: string | null
    current_period_end: string | null
    cancel_at_period_end: boolean
  } | null
  modules: { feature_key: string; active: boolean }[]
  overrides: {
    feature_key: string
    included_in_base_override: boolean | null
    price_cents_override: number | null
    discount_percent: number | null
  }[]
}

type AuditEvent = {
  id: string
  action: string
  target_company_id: string | null
  detail: unknown
  created_at: string
  actor_user_id: string | null
  company_name: string | null
}

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
// Short relative timestamp for the activity feed ("5m", "2h", "3d", else a date).
function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const secs = Math.round((Date.now() - d.getTime()) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days}d ago`
  return fmtDate(iso)
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
  const [tab, setTab] = useState<'pricing' | 'tenants' | 'invoices'>('pricing')
  const [features, setFeatures] = useState<BillingCatalogFeature[]>(initialFeatures)
  const toast = useToast()
  const [syncing, setSyncing] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  // Fold a newly-created item into local state (append + keep sort_order/key order stable).
  const handleCreated = (feature: BillingCatalogFeature) => {
    setFeatures((prev) =>
      [...prev, feature].sort(
        (a, b) => a.sort_order - b.sort_order || a.feature_key.localeCompare(b.feature_key),
      ),
    )
    setShowAdd(false)
  }

  // Distinct category strings currently in use — powers the datalist so you can pick an
  // existing category or type a brand-new one.
  const allCategories = Array.from(new Set(features.map((f) => f.category).filter(Boolean))).sort()

  // Push the catalog's prices to Stripe (creates/refreshes the Product + Price per
  // billable feature). Stripe Prices are immutable, so a changed amount mints a new
  // Price and archives the old one — run this after editing prices.
  async function syncStripe() {
    setSyncing(true)
    try {
      const res = await fetch('/api/platform/pricing/sync-stripe', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || 'Sync failed')
        return
      }
      const r = j.result || {}
      toast.success(`Synced ${r.synced ?? 0} price${r.synced === 1 ? '' : 's'} to Stripe (${r.mode ?? ''} mode)${r.skipped ? ` · ${r.skipped} skipped` : ''}`)
    } catch {
      toast.error('Sync failed')
    } finally {
      setSyncing(false)
    }
  }

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
        <TabButton active={tab === 'invoices'} onClick={() => setTab('invoices')}>
          Invoices
        </TabButton>
      </div>

      {tab === 'pricing' && (
        <div className="space-y-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-2xl text-sm text-gray-400">
              The master price sheet. Set the base fee, each module&apos;s price, and the per-unit rate for
              usage-based modules — changes auto-save. After changing a base price or a per-unit rate, click{' '}
              <span className="text-gray-200">Sync to Stripe</span> to push it (a new Stripe price is created and the
              old one archived, since Stripe prices are immutable).
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => setShowAdd((v) => !v)}
                className="rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/5"
              >
                {showAdd ? 'Close' : '+ Add item'}
              </button>
              <button
                onClick={syncStripe}
                disabled={syncing}
                className="rounded-lg bg-sky-500/90 px-3 py-2 text-sm font-medium text-[#fff] transition-colors hover:bg-sky-500 disabled:opacity-50"
              >
                {syncing ? 'Syncing…' : 'Sync to Stripe'}
              </button>
            </div>
          </div>

          {/* Shared datalists for the add-form + row detail editors */}
          <datalist id="catalog-categories">
            {allCategories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <datalist id="catalog-meters">
            {WIRED_METER_EVENTS.map((m) => (
              <option key={m.event_name} value={m.event_name}>
                {m.label}
              </option>
            ))}
          </datalist>

          {showAdd && <AddItemForm onCreated={handleCreated} onCancel={() => setShowAdd(false)} />}

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
      )}

      {tab === 'tenants' && <TenantsTable tenants={tenants} features={features} />}

      {tab === 'invoices' && <InvoicesTab tenants={tenants} mode={mode} />}
    </div>
  )
}

type InvoiceLineRow = {
  id: string
  feature_key: string
  label: string
  kind: 'base' | 'flat' | 'usage'
  quantity: number | null
  unit: string | null
  unit_price_cents: number | null
  amount_cents: number
  default_included: boolean
}

// Manual invoicing: pick a tenant + period → pull usage/fee lines → create a one-off
// Stripe invoice (draft, or finalize + email the customer).
function InvoicesTab({ tenants, mode }: { tenants: TenantSummary[]; mode: BillingMode }) {
  const toast = useToast()
  const [companyId, setCompanyId] = useState(tenants[0]?.company_id ?? '')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [lines, setLines] = useState<InvoiceLineRow[] | null>(null)
  const [included, setIncluded] = useState<Set<string>>(new Set())
  const [recipient, setRecipient] = useState('')
  const [dueDays, setDueDays] = useState('14')
  const [memo, setMemo] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    invoiceId: string
    status: string
    hostedUrl: string | null
  } | null>(null)

  // Default the period to the previous calendar month ([1st of last month, 1st of this
  // month) — the counters are half-open on the end date).
  useEffect(() => {
    const now = new Date()
    const firstThis = new Date(now.getFullYear(), now.getMonth(), 1)
    const firstLast = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setFrom(fmt(firstLast))
    setTo(fmt(firstThis))
  }, [])

  const total = lines
    ? lines.filter((l) => included.has(l.id)).reduce((s, l) => s + l.amount_cents, 0)
    : 0

  async function loadPreview() {
    if (!companyId || !from || !to) {
      toast.error('Pick a tenant and a date range.')
      return
    }
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch(
        `/api/platform/invoice/preview?company=${encodeURIComponent(companyId)}&from=${from}&to=${to}`,
      )
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || 'Could not load usage.')
        return
      }
      const ls = (j.lines || []) as InvoiceLineRow[]
      setLines(ls)
      setIncluded(new Set(ls.filter((l) => l.default_included).map((l) => l.id)))
    } catch {
      toast.error('Could not load usage.')
    } finally {
      setLoading(false)
    }
  }

  function toggle(id: string) {
    setIncluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function createInvoice(send: boolean) {
    const ids = Array.from(included)
    if (ids.length === 0) {
      toast.error('Select at least one line to bill.')
      return
    }
    if (send && (!recipient || !recipient.includes('@'))) {
      toast.error('Enter a valid recipient email to send.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/platform/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          from,
          to,
          included_line_ids: ids,
          recipient_email: recipient,
          due_days: Number(dueDays) || 14,
          memo,
          send,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || 'Could not create the invoice.')
        return
      }
      setResult({ invoiceId: j.invoiceId, status: j.status, hostedUrl: j.hostedUrl ?? null })
      toast.success(send ? 'Invoice created and sent.' : 'Draft invoice created.')
    } catch {
      toast.error('Could not create the invoice.')
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'rounded-lg border border-white/10 bg-gray-900 px-2 py-2 text-sm text-white outline-none'

  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-sm text-gray-400">
        Pull a subscriber&apos;s usage for a period and create a one-off Stripe invoice. Save it as a
        draft to review in Stripe, or create &amp; send it to email the customer a hosted invoice with
        a &quot;Pay now&quot; button. {mode === 'test' && 'Test mode — no real charges.'}
      </p>

      {/* Selectors */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[11px] text-gray-400">
          Subscriber
          <select
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value)
              setLines(null)
              setResult(null)
            }}
            className={`mt-1 block w-64 ${inputCls}`}
          >
            {tenants.map((t) => (
              <option key={t.company_id} value={t.company_id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-gray-400">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`mt-1 block ${inputCls}`} />
        </label>
        <label className="text-[11px] text-gray-400">
          To (exclusive)
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`mt-1 block ${inputCls}`} />
        </label>
        <button
          onClick={loadPreview}
          disabled={loading}
          className="rounded-lg bg-sky-500/90 px-3 py-2 text-sm font-medium text-[#fff] transition-colors hover:bg-sky-500 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load usage'}
        </button>
      </div>

      {/* Lines */}
      {lines && (
        <div className="space-y-4">
          {lines.length === 0 ? (
            <p className="text-sm text-gray-500">No billable items in the catalog.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2 font-medium">Bill</th>
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 font-medium">Detail</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-b border-white/5 last:border-0">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={included.has(l.id)}
                          onChange={() => toggle(l.id)}
                          className="h-4 w-4 accent-sky-500"
                        />
                      </td>
                      <td className="px-3 py-2 text-gray-200">
                        {l.label}
                        {l.kind === 'usage' && (
                          <span className="ml-1.5 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-violet-300">
                            usage
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-400">
                        {l.kind === 'usage'
                          ? `${l.quantity ?? 0} ${l.unit ?? 'unit'} × $${centsToDollarsPrecise(l.unit_price_cents)}`
                          : l.kind === 'base'
                            ? 'Base fee'
                            : 'Monthly fee'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-200">${centsToDollars(l.amount_cents)}</td>
                    </tr>
                  ))}
                  <tr className="bg-white/[0.02]">
                    <td />
                    <td className="px-3 py-2 font-semibold text-gray-100" colSpan={2}>
                      Total (selected)
                    </td>
                    <td className="px-3 py-2 text-right text-base font-bold text-white">${centsToDollars(total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Send details */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[11px] text-gray-400">
              Recipient email
              <input
                type="email"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="billing@customer.com"
                className={`mt-1 block w-64 ${inputCls} placeholder:text-gray-600`}
              />
            </label>
            <label className="text-[11px] text-gray-400">
              Due in (days)
              <input
                value={dueDays}
                onChange={(e) => setDueDays(e.target.value)}
                inputMode="numeric"
                className={`mt-1 block w-20 ${inputCls}`}
              />
            </label>
            <label className="flex-1 text-[11px] text-gray-400">
              Memo (optional)
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="Shown on the invoice"
                className={`mt-1 block w-full ${inputCls} placeholder:text-gray-600`}
              />
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => createInvoice(false)}
              disabled={busy}
              className="rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/5 disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Save as draft'}
            </button>
            <button
              onClick={() => createInvoice(true)}
              disabled={busy}
              className="rounded-lg bg-emerald-500/90 px-3 py-2 text-sm font-medium text-[#fff] transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Create & send'}
            </button>
          </div>

          {result && (
            <div className="rounded-lg border border-emerald-400/25 bg-emerald-500/[0.06] px-3 py-2 text-sm text-gray-200">
              Invoice <code className="text-xs text-gray-400">{result.invoiceId}</code> — {result.status}.{' '}
              {result.hostedUrl ? (
                <a href={result.hostedUrl} target="_blank" rel="noreferrer" className="text-sky-300 underline">
                  View / send link
                </a>
              ) : (
                'Draft — review & send it in Stripe.'
              )}
            </div>
          )}
        </div>
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

// Create-a-new-catalog-item form. Posts to POST /api/platform/pricing and hands the
// created row back via onCreated. feature_key is derived server-side from the name.
function AddItemForm({
  onCreated,
  onCancel,
}: {
  onCreated: (f: BillingCatalogFeature) => void
  onCancel: () => void
}) {
  const toast = useToast()
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState('')
  const [includedInBase, setIncludedInBase] = useState(false)
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [metered, setMetered] = useState(false)
  const [meterEvent, setMeterEvent] = useState('')
  const [unit, setUnit] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [busy, setBusy] = useState(false)

  const meterTrimmed = meterEvent.trim()
  const newMetric = metered && !isWiredMeter(meterTrimmed) // blank OR unknown = new metric

  // When the typed meter matches a wired one, prefill its unit for convenience.
  function onMeterChange(v: string) {
    setMeterEvent(v)
    const wired = WIRED_METER_EVENTS.find((m) => m.event_name === v.trim())
    if (wired) setUnit(wired.unit)
  }

  async function submit() {
    if (!label.trim()) {
      toast.error('Give the item a name.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/platform/pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          category: category.trim() || undefined,
          included_in_base: includedInBase,
          default_price_cents: dollarsToCents(price) ?? 0,
          cost_basis_cents: dollarsToCents(cost),
          metered,
          meter_event_name: metered ? meterTrimmed || undefined : undefined,
          usage_unit: metered ? unit.trim() || undefined : undefined,
          unit_price_cents: metered ? dollarsToCentsPrecise(unitPrice) ?? 0 : undefined,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || 'Could not create the item.')
        return
      }
      toast.success(`Added "${j.feature.label}" — click Sync to Stripe to provision its price.`)
      onCreated(j.feature as BillingCatalogFeature)
    } catch {
      toast.error('Could not create the item.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-sky-400/25 bg-sky-500/[0.04] p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-100">New item</h3>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <label className="text-[11px] text-gray-400">
          Name
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Premium Support"
            className="mt-1 block w-56 rounded-lg border border-white/10 bg-gray-900 px-2 py-2 text-sm text-white outline-none placeholder:text-gray-600"
          />
        </label>

        <label className="text-[11px] text-gray-400">
          Category
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            list="catalog-categories"
            placeholder="operations"
            className="mt-1 block w-40 rounded-lg border border-white/10 bg-gray-900 px-2 py-2 text-sm text-white outline-none placeholder:text-gray-600"
          />
        </label>

        <label className="text-[11px] text-gray-400">
          Type
          <select
            value={includedInBase ? 'included' : 'addon'}
            onChange={(e) => setIncludedInBase(e.target.value === 'included')}
            className="mt-1 block w-40 rounded-lg border border-white/10 bg-gray-900 px-2 py-2 text-sm text-white outline-none"
          >
            <option value="addon">Paid add-on</option>
            <option value="included">Included in base</option>
          </select>
        </label>

        <MoneyField label="Price" value={price} onChange={setPrice} placeholder="0.00" />
        <MoneyField label="Cost basis" value={cost} onChange={setCost} placeholder="—" />

        <label className="flex cursor-pointer items-center gap-2 pb-2 text-xs text-gray-300">
          <input
            type="checkbox"
            checked={metered}
            onChange={(e) => setMetered(e.target.checked)}
            className="h-4 w-4 accent-violet-500"
          />
          Usage-based
        </label>
      </div>

      {metered && (
        <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-3 rounded-lg border border-violet-400/20 bg-violet-500/[0.04] p-3">
          <label className="text-[11px] text-gray-400">
            Meter
            <input
              value={meterEvent}
              onChange={(e) => onMeterChange(e.target.value)}
              list="catalog-meters"
              placeholder="pick or type a new metric"
              className="mt-1 block w-56 rounded-lg border border-white/10 bg-gray-900 px-2 py-2 text-sm text-white outline-none placeholder:text-gray-600"
            />
          </label>
          <label className="text-[11px] text-gray-400">
            Unit
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="minute / message / unit"
              className="mt-1 block w-36 rounded-lg border border-white/10 bg-gray-900 px-2 py-2 text-sm text-white outline-none placeholder:text-gray-600"
            />
          </label>
          <MoneyField label="Per unit" value={unitPrice} onChange={setUnitPrice} placeholder="0.00" />
          {newMetric && (
            <p className="w-full text-[11px] text-amber-300/90">
              ⚠ New usage metric — it provisions in Stripe but bills <strong>$0 usage</strong> until a counter is
              wired in code. Pick one of the listed meters for automatic usage billing.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-lg bg-sky-500/90 px-3 py-2 text-sm font-medium text-[#fff] transition-colors hover:bg-sky-500 disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add item'}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-white/10 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-white/5 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function FeatureRow({ feature, onSave }: { feature: BillingCatalogFeature; onSave: SaveFn }) {
  const toast = useToast()
  const [label, setLabel] = useState(feature.label)
  const [price, setPrice] = useState(centsToDollars(feature.default_price_cents))
  const [cost, setCost] = useState(centsToDollars(feature.cost_basis_cents))
  const [unitPrice, setUnitPrice] = useState(centsToDollarsPrecise(feature.unit_price_cents))
  const [category, setCategory] = useState(feature.category)
  const [meterEvent, setMeterEvent] = useState(feature.meter_event_name ?? '')
  const [unit, setUnit] = useState(feature.usage_unit ?? '')
  const [details, setDetails] = useState(false)
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

  // Live margin off the current edits (price/cost are dollar strings in state):
  // dollars = price − cost_basis, % = (price − cost) / price. Undefined when the
  // cost basis is blank or the price is 0.
  const priceCents = dollarsToCents(price) ?? 0
  const costCents = dollarsToCents(cost)
  const showMargin = costCents != null && priceCents > 0
  const marginCents = showMargin ? priceCents - costCents : 0
  const marginPct = showMargin ? Math.round((marginCents / priceCents) * 100) : 0

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
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <code className="text-[11px] text-gray-500">{feature.feature_key}</code>
            {feature.metered && (
              <span
                className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-300"
                title="Usage-based module: a flat base price plus a per-unit rate billed in arrears"
              >
                Usage-based
              </span>
            )}
          </div>
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

        {/* Margin (read-only, derived from price − cost basis) */}
        <div className="text-[11px] text-gray-400" title="Margin = price − cost basis">
          Margin
          <div className="mt-1 flex h-[38px] items-center rounded-lg border border-white/10 bg-white/[0.02] px-2">
            {showMargin ? (
              <span className="text-sm">
                <span className={marginCents < 0 ? 'text-red-400' : 'text-gray-200'}>
                  {marginCents < 0 ? '−$' : '$'}
                  {centsToDollars(Math.abs(marginCents))}
                </span>{' '}
                <span className="text-gray-500">({marginPct}%)</span>
              </span>
            ) : (
              <span className="text-sm text-gray-600">—</span>
            )}
          </div>
        </div>

        {/* Per-unit rate (metered modules only) — the flat Price above still applies;
            this is the usage rate billed in arrears (e.g. $0.05 per minute). */}
        {feature.metered && (
          <MoneyField
            label={`Per ${feature.usage_unit || 'unit'}`}
            value={unitPrice}
            placeholder="—"
            title="Usage rate billed per unit, in arrears"
            onChange={(v) => {
              setUnitPrice(v)
              scheduleSave('unitPrice', { unit_price_cents: dollarsToCentsPrecise(v) }, () =>
                setUnitPrice(centsToDollarsPrecise(feature.unit_price_cents)),
              )
            }}
          />
        )}

        {/* Active */}
        <Toggle label="Active" checked={feature.active} onChange={(v) => runSave({ active: v })} />

        {/* Details expander (category / usage-based) */}
        <button
          onClick={() => setDetails((v) => !v)}
          className="text-[11px] text-gray-400 underline-offset-2 hover:text-gray-200 hover:underline"
          title="Edit category and usage-based settings"
        >
          {details ? 'Hide details' : 'Details'}
        </button>

        {/* Status */}
        <span className="w-14 text-right text-[11px]">
          {status === 'saving' && <span className="text-gray-500">Saving…</span>}
          {status === 'saved' && <span className="text-emerald-400">Saved</span>}
          {status === 'error' && <span className="text-red-400">Error</span>}
        </span>
      </div>

      {details && (
        <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-3 border-t border-white/10 pt-3">
          {/* Category (editable; base row keeps its category too) */}
          <label className="text-[11px] text-gray-400">
            Category
            <input
              value={category}
              list="catalog-categories"
              onChange={(e) => {
                setCategory(e.target.value)
                scheduleSave('category', { category: e.target.value.trim() || 'operations' }, () =>
                  setCategory(feature.category),
                )
              }}
              className="mt-1 block w-40 rounded-lg border border-white/10 bg-gray-900 px-2 py-2 text-sm text-white outline-none"
            />
          </label>

          {/* Usage-based toggle — the base row is never metered */}
          {!feature.is_base && (
            <div className="pb-2">
              <Toggle
                label="Usage-based"
                checked={feature.metered}
                onChange={(v) => runSave({ metered: v })}
              />
            </div>
          )}

          {/* Meter + unit (only when metered) */}
          {feature.metered && (
            <>
              <label className="text-[11px] text-gray-400">
                Meter
                <input
                  value={meterEvent}
                  list="catalog-meters"
                  onChange={(e) => {
                    setMeterEvent(e.target.value)
                    scheduleSave(
                      'meter',
                      { meter_event_name: e.target.value.trim() || null },
                      () => setMeterEvent(feature.meter_event_name ?? ''),
                    )
                  }}
                  className="mt-1 block w-56 rounded-lg border border-white/10 bg-gray-900 px-2 py-2 text-sm text-white outline-none"
                />
              </label>
              <label className="text-[11px] text-gray-400">
                Unit
                <input
                  value={unit}
                  onChange={(e) => {
                    setUnit(e.target.value)
                    scheduleSave('unit', { usage_unit: e.target.value.trim() || null }, () =>
                      setUnit(feature.usage_unit ?? ''),
                    )
                  }}
                  className="mt-1 block w-32 rounded-lg border border-white/10 bg-gray-900 px-2 py-2 text-sm text-white outline-none"
                />
              </label>
              {!isWiredMeter(feature.meter_event_name) && (
                <p className="w-full text-[11px] text-amber-300/90">
                  ⚠ This meter has no usage counter wired — it bills <strong>$0 usage</strong> until one is added in
                  code. The flat price still applies.
                </p>
              )}
            </>
          )}
        </div>
      )}
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

function TenantsTable({ tenants: initialTenants, features }: { tenants: TenantSummary[]; features: BillingCatalogFeature[] }) {
  const [tenants, setTenants] = useState<TenantSummary[]>(initialTenants)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  // The slug of the most recently added tenant — drives the DNS-reminder note that
  // stays visible until the next add (there is no live signal for whether DNS exists yet).
  const [lastAddedSlug, setLastAddedSlug] = useState<string | null>(null)

  function setActive(companyId: string, active: boolean) {
    setTenants((prev) => prev.map((t) => (t.company_id === companyId ? { ...t, is_active: active } : t)))
  }

  function handleAdded(t: TenantSummary) {
    setTenants((prev) => [t, ...prev])
    setLastAddedSlug(t.subdomain_slug)
    setShowAdd(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          Every tenant company on the platform. Add a new subscriber, then manage each plan, suspension, and price
          overrides below.
        </p>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="shrink-0 rounded-lg bg-sky-500/90 px-3 py-2 text-sm font-medium text-[#fff] transition-colors hover:bg-sky-500"
        >
          {showAdd ? 'Cancel' : '+ Add subscriber'}
        </button>
      </div>

      {showAdd && <AddSubscriberForm onAdded={handleAdded} onClose={() => setShowAdd(false)} />}

      {lastAddedSlug && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span className="font-semibold">⚠ Next step:</span> the subdomain{' '}
          <code className="rounded bg-black/30 px-1 py-0.5 text-amber-100">{lastAddedSlug}.lynxedo.com</code> must have
          its DNS wired before this tenant can log in on production — ask your developer to add it.
        </div>
      )}

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
              tenants.map((t) => {
                const isOpen = expanded === t.company_id
                return (
                  <Fragment key={t.company_id}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : t.company_id)}
                      className="cursor-pointer border-b border-white/5 last:border-0 hover:bg-white/[0.03]"
                    >
                      <td className="px-3 py-2 text-gray-200">
                        <span className="flex items-center gap-2">
                          <span
                            className={`inline-block text-gray-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                            aria-hidden
                          >
                            ▶
                          </span>
                          {t.name}
                        </span>
                      </td>
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
                          <span className="text-red-400">Suspended</span>
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
                    {isOpen && (
                      <tr className="border-b border-white/5 last:border-0 bg-black/20">
                        <td colSpan={6} className="px-3 py-4">
                          <TenantDetailPanel
                            companyId={t.company_id}
                            features={features}
                            onActiveChange={(active) => setActive(t.company_id, active)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        Companies with no subscription row are fully entitled — billing gating fails open — until you put them on a
        plan. Click a tenant to manage its plan, suspension, and per-feature price overrides.
      </p>

      <AuditSection />
    </div>
  )
}

// "+ Add subscriber" — creates a brand-new tenant company and invites its owner (who
// is elevated to a full company admin) via POST /api/platform/tenants. On success the
// caller prepends the returned tenant and shows the DNS-wiring reminder.
const SLUG_RE = /^[a-z0-9-]{2,40}$/
function AddSubscriberForm({
  onAdded,
  onClose,
}: {
  onAdded: (t: TenantSummary) => void
  onClose: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [email, setEmail] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slugInvalid = slug.length > 0 && !SLUG_RE.test(slug)

  async function submit() {
    setError(null)
    const trimmedName = name.trim()
    const trimmedSlug = slug.trim().toLowerCase()
    const trimmedEmail = email.trim()
    if (!trimmedName || !trimmedSlug || !trimmedEmail) {
      setError('Company name, subdomain, and owner email are required.')
      return
    }
    if (!SLUG_RE.test(trimmedSlug)) {
      setError('Subdomain must be 2–40 characters: lowercase letters, numbers, and hyphens only.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/platform/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          subdomain_slug: trimmedSlug,
          owner_email: trimmedEmail,
          owner_name: ownerName.trim() || undefined,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j.error || 'Could not add subscriber.')
        return
      }
      const c = j.company as { id: string; name: string; subdomain_slug: string | null; is_active: boolean }
      onAdded({
        company_id: c.id,
        name: c.name,
        subdomain_slug: c.subdomain_slug,
        is_active: c.is_active,
        subscription: null,
        active_module_count: 0,
      })
      toast.success(`${c.name} added — owner invite sent to ${trimmedEmail}`)
    } catch {
      setError('Could not add subscriber.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-200">New subscriber</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Lawn Care"
            className="w-full rounded-lg border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-sky-500/60"
          />
        </Field>
        <Field label="Subdomain" hint=".lynxedo.com">
          <div className="flex items-center rounded-lg border border-white/10 bg-gray-900 px-3">
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="acme"
              className="w-full bg-transparent py-2 text-sm text-white outline-none placeholder:text-gray-600"
            />
            <span className="whitespace-nowrap text-xs text-gray-500">.lynxedo.com</span>
          </div>
          {slugInvalid && (
            <span className="mt-1 block text-[11px] text-red-400">
              2–40 chars; lowercase letters, numbers, hyphens only.
            </span>
          )}
        </Field>
        <Field label="Owner email">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="owner@acme.com"
            className="w-full rounded-lg border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-sky-500/60"
          />
        </Field>
        <Field label="Owner name" hint="optional">
          <input
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="Jane Doe"
            className="w-full rounded-lg border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-sky-500/60"
          />
        </Field>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-lg bg-sky-500/90 px-3 py-2 text-sm font-medium text-[#fff] transition-colors hover:bg-sky-500 disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add subscriber'}
        </button>
        <button
          onClick={onClose}
          disabled={busy}
          className="rounded-lg border border-white/10 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-white/5 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Creates the company and emails the owner a magic-link invite. They land as a full admin of the new tenant.
      </p>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500">
        {label}
        {hint && <span className="ml-1 lowercase text-gray-600">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

// Lazy-loaded per-tenant detail: subscription snapshot, active modules, a
// suspend/activate control, and the per-feature price-override editor.
function TenantDetailPanel({
  companyId,
  features,
  onActiveChange,
}: {
  companyId: string
  features: BillingCatalogFeature[]
  onActiveChange: (active: boolean) => void
}) {
  const toast = useToast()
  const [detail, setDetail] = useState<TenantDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/platform/tenants/${companyId}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Could not load tenant.')
        return j as TenantDetail
      })
      .then((j) => {
        if (!cancelled) setDetail(j)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId])

  async function toggleActive() {
    if (!detail) return
    const next = !detail.company.is_active
    if (!next && !window.confirm(`Suspend ${detail.company.name}? They will lose access until reactivated.`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/platform/tenants/${companyId}/active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: next }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || 'Could not update tenant.')
        return
      }
      const isActive = Boolean(j.is_active)
      setDetail((d) => (d ? { ...d, company: { ...d.company, is_active: isActive } } : d))
      onActiveChange(isActive)
      toast.success(isActive ? 'Tenant activated' : 'Tenant suspended')
    } catch {
      toast.error('Could not update tenant.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>
  if (error) return <p className="text-sm text-red-400">{error}</p>
  if (!detail) return null

  const labelFor = (key: string) => features.find((f) => f.feature_key === key)?.label ?? key
  const activeModules = detail.modules.filter((m) => m.active)
  const billable = features.filter((f) => !f.is_base && !f.included_in_base)
  const overrideByKey = new Map(detail.overrides.map((o) => [o.feature_key, o]))

  return (
    <div className="space-y-5">
      {/* Subscription + suspend/activate */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {detail.subscription ? (
              <StatusPill status={detail.subscription.status} />
            ) : (
              <span className="text-sm italic text-gray-600">No billing yet</span>
            )}
            {detail.subscription?.cancel_at_period_end && (
              <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300">
                Cancels at period end
              </span>
            )}
          </div>
          {detail.subscription && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-400">
              <span>
                Trial ends: <span className="text-gray-200">{fmtDate(detail.subscription.trial_ends_at)}</span>
              </span>
              <span>
                Renews on: <span className="text-gray-200">{fmtDate(detail.subscription.current_period_end)}</span>
              </span>
            </div>
          )}
        </div>
        <button
          onClick={toggleActive}
          disabled={busy}
          className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
            detail.company.is_active
              ? 'bg-red-500/90 text-[#fff] hover:bg-red-500'
              : 'bg-emerald-500/90 text-[#fff] hover:bg-emerald-500'
          }`}
        >
          {busy ? 'Saving…' : detail.company.is_active ? 'Suspend' : 'Activate'}
        </button>
      </div>

      {/* Active modules */}
      <div>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Active modules</h3>
        {activeModules.length === 0 ? (
          <p className="text-sm text-gray-500">No active modules.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {activeModules.map((m) => (
              <span
                key={m.feature_key}
                className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-gray-300"
              >
                {labelFor(m.feature_key)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Per-feature price overrides */}
      <div>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Price overrides for this tenant
        </h3>
        {billable.length === 0 ? (
          <p className="text-sm text-gray-500">No billable add-ons to override.</p>
        ) : (
          <div className="space-y-1.5">
            {billable.map((f) => (
              <TenantOverrideRow
                key={f.feature_key}
                companyId={companyId}
                feature={f}
                initial={overrideByKey.get(f.feature_key)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// One compact override row: tri-state "included in base for this tenant" +
// a price-override field (blank = inherit the catalog default) + a discount % that
// takes X% off this module's monthly fee for this tenant. Save/Clear.
function TenantOverrideRow({
  companyId,
  feature,
  initial,
}: {
  companyId: string
  feature: BillingCatalogFeature
  initial: TenantDetail['overrides'][number] | undefined
}) {
  const toast = useToast()
  const [inc, setInc] = useState<'inherit' | 'yes' | 'no'>(
    initial == null || initial.included_in_base_override == null
      ? 'inherit'
      : initial.included_in_base_override
        ? 'yes'
        : 'no',
  )
  const [price, setPrice] = useState(centsToDollars(initial?.price_cents_override))
  const [discount, setDiscount] = useState(
    initial?.discount_percent != null ? String(initial.discount_percent) : '',
  )
  const [busy, setBusy] = useState(false)

  // Effective monthly price = (override price ?? catalog default) minus the discount %.
  const baseCents = dollarsToCents(price) ?? feature.default_price_cents
  const discNum = Number(discount)
  const discValid = discount.trim() !== '' && Number.isFinite(discNum) && discNum > 0 && discNum <= 100
  const effectiveCents = discValid ? Math.round(baseCents * (1 - discNum / 100)) : baseCents

  async function save() {
    setBusy(true)
    try {
      const res = await fetch(`/api/platform/pricing/${feature.feature_key}/override`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          included_in_base_override: inc === 'inherit' ? null : inc === 'yes',
          price_cents_override: dollarsToCents(price),
          discount_percent: discount.trim() === '' ? null : Number(discount),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || 'Could not save override.')
        return
      }
      toast.success(`Override saved for ${feature.label}`)
    } catch {
      toast.error('Could not save override.')
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    setBusy(true)
    try {
      const res = await fetch(`/api/platform/pricing/${feature.feature_key}/override`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || 'Could not clear override.')
        return
      }
      setInc('inherit')
      setPrice('')
      setDiscount('')
      toast.success(`Override cleared for ${feature.label}`)
    } catch {
      toast.error('Could not clear override.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <span className="min-w-[150px] flex-1 text-sm text-gray-200">{feature.label}</span>

      <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
        In base
        <select
          value={inc}
          onChange={(e) => setInc(e.target.value as 'inherit' | 'yes' | 'no')}
          className="rounded-md border border-white/10 bg-gray-900 px-2 py-1 text-xs text-white outline-none"
        >
          <option value="inherit">Inherit</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
        Price
        <span className="flex items-center rounded-md border border-white/10 bg-gray-900 px-2">
          <span className="text-xs text-gray-500">$</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="inherit"
            className="w-16 bg-transparent px-1 py-1 text-xs text-white outline-none placeholder:text-gray-600"
          />
        </span>
      </label>

      <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
        Discount
        <span className="flex items-center rounded-md border border-white/10 bg-gray-900 px-2">
          <input
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            className="w-12 bg-transparent px-1 py-1 text-xs text-white outline-none placeholder:text-gray-600"
          />
          <span className="text-xs text-gray-500">%</span>
        </span>
      </label>

      {discValid && (
        <span className="text-[11px] text-emerald-300/90">= ${centsToDollars(effectiveCents)}/mo</span>
      )}

      <div className="flex items-center gap-1.5">
        <button
          onClick={save}
          disabled={busy}
          className="rounded-md bg-sky-500/90 px-2.5 py-1 text-xs font-medium text-[#fff] transition-colors hover:bg-sky-500 disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={clear}
          disabled={busy}
          className="rounded-md border border-white/10 px-2.5 py-1 text-xs font-medium text-gray-300 transition-colors hover:bg-white/5 disabled:opacity-50"
        >
          Clear
        </button>
      </div>
    </div>
  )
}

// Collapsible, read-only recent-activity feed (lazy-fetched on first open).
function AuditSection() {
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<AuditEvent[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && events == null && !loading) {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/platform/audit')
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.error || 'Could not load activity.')
        setEvents((j.events || []) as AuditEvent[])
      } catch (e: unknown) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div className="rounded-xl border border-white/10">
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium text-gray-200"
      >
        <span>Recent activity</span>
        <span className={`text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>
          ▶
        </span>
      </button>
      {open && (
        <div className="border-t border-white/10 px-3 py-3">
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : !events || events.length === 0 ? (
            <p className="text-sm text-gray-500">No activity yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {events.map((ev) => (
                <li key={ev.id} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span className="text-gray-200">
                    {ev.action.replace(/_/g, ' ')}
                    {(ev.company_name || ev.target_company_id) && (
                      <span className="text-gray-400"> · {ev.company_name || ev.target_company_id}</span>
                    )}
                  </span>
                  <span className="text-[11px] text-gray-500">{fmtRelative(ev.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
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
