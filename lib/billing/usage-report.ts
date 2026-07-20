// Usage-based (metered) billing reporter (Track 5, M4.5).
//
// Once per cron tick, for every subscribed tenant and every metered catalog feature the
// tenant actually has, this reads how much usage accrued since the last watermark and
// reports the total to the matching Stripe Billing Meter as a single meter event.
//
// Design guarantees:
//   • Never back-bill history. A (company, meter) pair with no watermark row is
//     watermarked at the current cutoff and SKIPPED this run — reporting starts from
//     the moment the pair is first seen (i.e. activation), not from account creation.
//   • Under-bill, never over-bill. The meter event identifier is keyed to the WINDOW
//     START, so a retried window collapses to the same event (Stripe dedups identifiers
//     within a rolling ≥24h period). If a window is missed we lose that usage rather
//     than risk double-charging.
//   • One cutoff per run so every window closes at the same instant.
//   • Per-pair try/catch: a failure leaves the watermark UNADVANCED so the same window
//     retries next tick, and never aborts the rest of the run.
//
// ⚠ Outbound dialer minutes are attributed to Heroes only until the outbound TwiML route
// (app/api/dialer/voice/twiml/outbound/route.ts) is de-hardcoded off HEROES_COMPANY_ID.
// Inbound calls, Amber (AI receptionist) minutes, and txt messages are per-tenant correct.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BillingMode } from './types'
import { getStripe } from './stripe'
import { getBillingMode } from './catalog'

type Admin = SupabaseClient<any, any, any>

// meter_event_name → the service-role RPC that totals that usage for a (company, window).
// Each RPC signature is (p_company uuid, p_from timestamptz, p_to timestamptz) → bigint.
const USAGE_RPC: Record<string, string> = {
  call_minutes: 'billing_usage_dialer_minutes',
  ai_minutes: 'billing_usage_ai_minutes',
  text_messages: 'billing_usage_text_count',
}

type ReportSummary = {
  mode: BillingMode
  companies: number
  reported: number
  skipped: number
  details?: unknown
}

/**
 * Sweep every subscribed tenant × metered feature and report accrued usage to Stripe.
 *
 * `companies` = subscribed tenants considered. `reported` = meter events successfully
 * created (usage > 0). `skipped` = pairs that produced no event this run (first-seen
 * watermark init, zero usage, no active module, or error). `details` carries a compact
 * breakdown plus any per-pair errors for debugging.
 */
export async function reportUsage(admin: Admin): Promise<ReportSummary> {
  const mode = getBillingMode()
  const cutoff = new Date().toISOString() // ONE cutoff for the whole run
  const stripe = getStripe()

  // Tenants with a billable subscription + a Stripe customer for this mode.
  const { data: subRows } = await admin
    .from('company_subscription')
    .select('company_id, stripe_customer_id, status')
    .eq('mode', mode)
    .in('status', ['trialing', 'active', 'past_due'])
    .not('stripe_customer_id', 'is', null)
  const subs = (subRows ?? []) as Array<{
    company_id: string
    stripe_customer_id: string | null
    status: string
  }>

  // Metered, active catalog features (dialer / txt / ai_receptionist).
  const { data: featRows } = await admin
    .from('billing_catalog')
    .select('feature_key, meter_event_name')
    .eq('metered', true)
    .eq('active', true)
  const features = (featRows ?? []) as Array<{
    feature_key: string
    meter_event_name: string | null
  }>

  let reported = 0
  let skipped = 0
  let firstRunInits = 0
  let zeroUsage = 0
  let noModule = 0
  const errors: Array<{ company_id: string; meter_event_name: string; error: string }> = []

  // Short-circuit when there is nothing to do.
  if (subs.length === 0 || features.length === 0) {
    return { mode, companies: subs.length, reported, skipped, details: { pairs: 0 } }
  }

  const companyIds = subs.map((s) => s.company_id)

  // Which (company, feature) modules are ACTIVE for this mode — a company only bills for a
  // metered feature it's actually subscribed to. Keyed `${company_id}|${feature_key}`.
  const { data: moduleRows } = await admin
    .from('company_module_subscription')
    .select('company_id, feature_key')
    .eq('mode', mode)
    .eq('active', true)
    .in('company_id', companyIds)
  const activeModules = new Set<string>()
  for (const m of (moduleRows ?? []) as Array<{ company_id: string; feature_key: string }>) {
    activeModules.add(`${m.company_id}|${m.feature_key}`)
  }

  // Existing watermarks for this mode, keyed `${company_id}|${meter_event_name}`.
  const { data: wmRows } = await admin
    .from('billing_usage_watermark')
    .select('company_id, meter_event_name, watermarked_at')
    .eq('mode', mode)
    .in('company_id', companyIds)
  const watermarks = new Map<string, string>()
  for (const w of (wmRows ?? []) as Array<{
    company_id: string
    meter_event_name: string
    watermarked_at: string
  }>) {
    watermarks.set(`${w.company_id}|${w.meter_event_name}`, w.watermarked_at)
  }

  let pairs = 0

  for (const sub of subs) {
    const companyId = sub.company_id
    const customerId = sub.stripe_customer_id
    if (!customerId) {
      skipped++
      continue
    }

    for (const feat of features) {
      const eventName = feat.meter_event_name
      if (!eventName) continue // a metered feature with no event name is unconfigured
      const rpcName = USAGE_RPC[eventName]
      if (!rpcName) continue // no RPC wired for this meter — nothing to total

      // The company must actually subscribe to this metered module.
      if (!activeModules.has(`${companyId}|${feat.feature_key}`)) {
        noModule++
        skipped++
        continue
      }

      pairs++
      const wmKey = `${companyId}|${eventName}`

      try {
        const windowStart = watermarks.get(wmKey)

        // First time we've seen this pair → watermark at activation, report NOTHING.
        if (!windowStart) {
          await admin.from('billing_usage_watermark').upsert(
            {
              company_id: companyId,
              meter_event_name: eventName,
              mode,
              watermarked_at: cutoff,
              updated_at: cutoff,
            },
            { onConflict: 'company_id,meter_event_name,mode' },
          )
          firstRunInits++
          skipped++
          continue
        }

        // Total usage in [windowStart, cutoff).
        const { data: usageData, error: rpcError } = await admin.rpc(rpcName, {
          p_company: companyId,
          p_from: windowStart,
          p_to: cutoff,
        })
        if (rpcError) throw new Error(rpcError.message)
        const usage = Number((usageData as unknown as number | string | null) ?? 0)

        if (usage > 0) {
          // identifier keyed to the WINDOW START → a retried window dedups to one event.
          const identifier = `${companyId}:${eventName}:${Math.floor(new Date(windowStart).getTime() / 1000)}`
          await stripe.billing.meterEvents.create({
            event_name: eventName,
            payload: { stripe_customer_id: customerId, value: String(usage) },
            identifier,
          })
          reported++
        } else {
          zeroUsage++
          skipped++
        }

        // Advance the watermark only after a clean report (usage 0 counts as reported-none).
        await admin.from('billing_usage_watermark').upsert(
          {
            company_id: companyId,
            meter_event_name: eventName,
            mode,
            watermarked_at: cutoff,
            updated_at: cutoff,
          },
          { onConflict: 'company_id,meter_event_name,mode' },
        )
      } catch (e) {
        // Do NOT advance the watermark — the same window retries next run.
        skipped++
        errors.push({ company_id: companyId, meter_event_name: eventName, error: (e as Error).message })
      }
    }
  }

  return {
    mode,
    companies: subs.length,
    reported,
    skipped,
    details: { pairs, firstRunInits, zeroUsage, noModule, errors },
  }
}
