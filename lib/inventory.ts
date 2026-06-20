// lib/inventory.ts
// Master PRD Session 10 — Inventory stock & decrement.
//
// When a route's spraying is done (the day's last stop is marked complete), the
// route's stored loadout (Session 8: daily_log_entries.route_loadout) tells us
// how much of each product was applied — in application units (oz/lb). We convert
// that to PACKAGES (product_location_inventory.quantity is packages) via
// packages = applied ÷ package_size, write an audit row to inventory_movements,
// and decrement the stock at the configured deduct location.
//
// Idempotent: the inventory_movements partial unique index (company_id, ref_type,
// ref_id, product_id WHERE reason='route_spray') means a route decrements each
// product at most once — reopen + re-complete of the last stop won't double-count.
//
// Low-stock: when a decrement crosses a product's reorder_threshold (total on-hand
// across all locations), @Guardian DMs/posts to the configured recipients.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { fanoutGuardianNotification } from '@/lib/guardian-post'
import { fmtQty } from '@/lib/route-capacity'
import type { StoredRouteLoadout } from '@/lib/route-capacity'

type Admin = SupabaseClient

export type InventorySettings = {
  company_id: string
  deduct_location_id: string | null
  low_stock_alerts_enabled: boolean
  alert_recipient_user_ids: string[]
  alert_recipient_room_ids: string[]
}

async function loadInventorySettings(admin: Admin, companyId: string): Promise<InventorySettings | null> {
  const { data } = await admin
    .from('inventory_settings')
    .select('company_id, deduct_location_id, low_stock_alerts_enabled, alert_recipient_user_ids, alert_recipient_room_ids')
    .eq('company_id', companyId)
    .maybeSingle<InventorySettings>()
  return data ?? null
}

// Which location route-spray decrements from: the configured one, else the
// active location with the lowest sort_order (the "primary" store).
async function resolveDeductLocationId(
  admin: Admin,
  companyId: string,
  settings: InventorySettings | null,
): Promise<string | null> {
  if (settings?.deduct_location_id) return settings.deduct_location_id
  const { data } = await admin
    .from('inventory_locations')
    .select('id')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>()
  return data?.id ?? null
}

async function totalOnHand(admin: Admin, companyId: string, productId: string): Promise<number> {
  const { data } = await admin
    .from('product_location_inventory')
    .select('quantity')
    .eq('company_id', companyId)
    .eq('product_id', productId)
  return (data ?? []).reduce((sum, r) => sum + (Number(r.quantity) || 0), 0)
}

/**
 * Decrement inventory for a completed route's stored loadout. Best-effort: logs
 * and continues on any per-product problem, never throws. Returns a small summary
 * for logging.
 */
export async function applyRouteSprayDecrements(args: {
  admin?: Admin
  companyId: string
  entryId: string
  loadout: StoredRouteLoadout | null
}): Promise<{ decremented: number; skipped: number; crossed: number }> {
  const admin = args.admin ?? createAdminClient()
  const { companyId, entryId, loadout } = args
  const summary = { decremented: 0, skipped: 0, crossed: 0 }
  if (!loadout || !Array.isArray(loadout.products) || loadout.products.length === 0) return summary

  const settings = await loadInventorySettings(admin, companyId)
  const locationId = await resolveDeductLocationId(admin, companyId, settings)
  if (!locationId) {
    console.warn('[inventory] no active location to deduct from; skipping route', entryId)
    return summary
  }

  const productIds = [...new Set(loadout.products.map(p => p.product_id).filter(Boolean))]
  if (productIds.length === 0) return summary
  const { data: prods } = await admin
    .from('products')
    .select('id, name, package_size, reorder_threshold')
    .in('id', productIds)
    .eq('company_id', companyId)
  const byId = new Map((prods ?? []).map(p => [p.id, p as { id: string; name: string; package_size: number | null; reorder_threshold: number | null }]))

  const crossed: Array<{ name: string; total: number; threshold: number }> = []
  const nowIso = new Date().toISOString()

  for (const line of loadout.products) {
    const prod = byId.get(line.product_id)
    if (!prod) { summary.skipped++; continue }
    const pkgSize = Number(prod.package_size)
    const qty = Number(line.quantity)
    if (!isFinite(pkgSize) || pkgSize <= 0) {
      console.warn(`[inventory] ${prod.name}: no package_size — can't convert ${qty}${line.unit} to packages`)
      summary.skipped++
      continue
    }
    if (!isFinite(qty) || qty <= 0) { summary.skipped++; continue }
    const packages = qty / pkgSize

    // Idempotent ledger insert — DO NOTHING if this route already decremented this product.
    const { data: mv, error: mvErr } = await admin
      .from('inventory_movements')
      .upsert(
        {
          company_id: companyId, product_id: line.product_id, location_id: locationId,
          delta: -packages, reason: 'route_spray', ref_type: 'daily_log_entry', ref_id: entryId,
          note: `Route spray: ${fmtQty(qty)} ${line.unit} ${prod.name}`,
        },
        { onConflict: 'company_id,ref_type,ref_id,product_id', ignoreDuplicates: true },
      )
      .select('id')
      .maybeSingle()
    if (mvErr) { console.error('[inventory] movement insert failed:', mvErr.message); summary.skipped++; continue }
    if (!mv) { summary.skipped++; continue } // already counted for this route

    // Decrement the location's package count (create the row if missing).
    const { data: invRow } = await admin
      .from('product_location_inventory')
      .select('id, quantity')
      .eq('company_id', companyId)
      .eq('product_id', line.product_id)
      .eq('location_id', locationId)
      .maybeSingle<{ id: string; quantity: number }>()
    if (invRow) {
      await admin
        .from('product_location_inventory')
        .update({ quantity: (Number(invRow.quantity) || 0) - packages, updated_at: nowIso })
        .eq('id', invRow.id)
    } else {
      await admin
        .from('product_location_inventory')
        .insert({ company_id: companyId, product_id: line.product_id, location_id: locationId, quantity: -packages })
    }
    summary.decremented++

    // Low-stock crossing: only alert when this decrement took total on-hand from
    // >= threshold to < threshold (avoids re-alerting every route once it's low).
    const threshold = prod.reorder_threshold == null ? null : Number(prod.reorder_threshold)
    if (threshold != null && isFinite(threshold)) {
      const totalAfter = await totalOnHand(admin, companyId, line.product_id)
      const totalBefore = totalAfter + packages
      if (totalBefore >= threshold && totalAfter < threshold) {
        crossed.push({ name: prod.name, total: totalAfter, threshold })
      }
    }
  }

  // Fan out one low-stock alert covering everything that crossed.
  if (crossed.length > 0 && (settings?.low_stock_alerts_enabled ?? true)) {
    summary.crossed = crossed.length
    const userIds = settings?.alert_recipient_user_ids ?? []
    const roomIds = settings?.alert_recipient_room_ids ?? []
    if (userIds.length > 0 || roomIds.length > 0) {
      const lines = crossed.map(c => `• ${c.name}: ${fmtQty(c.total)} pkg left (reorder at ${fmtQty(c.threshold)})`)
      const body = `⚠️ Low stock — time to reorder:\n${lines.join('\n')}\n\nUpdate counts in Admin → Products once restocked.`
      await fanoutGuardianNotification({ companyId, userIds, roomIds, body, admin }).catch(err =>
        console.error('[inventory] low-stock alert fanout failed:', err))
    } else {
      console.log('[inventory] low-stock crossed but no alert recipients configured')
    }
  }

  return summary
}
