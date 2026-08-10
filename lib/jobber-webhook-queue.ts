/**
 * Durable queue for inbound Jobber webhook events.
 *
 * The problem this exists to solve: the webhook route must ack Jobber with a 200
 * within seconds, so processing happens after the ack — and Jobber never retries
 * anything it was told we accepted. Any post-ack failure was therefore permanent
 * data loss. Measured on prod before this shipped: 242 events dropped, all with
 * "No usable Jobber token" from a refresh-token rotation race.
 *
 * The contract now: the 200 means "durably recorded", not "successfully
 * processed". Events land in `jobber_webhook_events` first; a drain worker
 * retries with exponential backoff and dead-letters with an alert once attempts
 * are exhausted. Nothing is ever silently lost.
 *
 * Rows carry company_id, so the drain is multi-tenant from day one.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { processJobberWebhookEvent, notifyJobberSyncFailure } from '@/lib/jobber-sync'

export type JobberWebhookEventRow = {
  id: string
  company_id: string
  topic: string
  item_id: string
  occurred_at: string | null
  attempts: number
}

/**
 * Backoff per attempt number (1-based). Front-loaded: the dominant failure mode
 * is a transient token race or a Jobber throttle, both of which clear in
 * seconds. The long tail exists so a multi-hour outage doesn't burn attempts.
 */
const BACKOFF_SECONDS = [30, 120, 600, 3600, 21600] as const
const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1

/** Events claimed per drain pass. Bursts are small; this is a safety valve. */
export const DRAIN_BATCH_SIZE = 25

function backoffSeconds(attempts: number): number {
  return BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length) - 1] ?? 30
}

/**
 * Record an inbound event. Called from the webhook route BEFORE it acks.
 *
 * Deduped on dedupe_key so a Jobber redelivery collapses onto the existing row
 * instead of queueing twice. When `occurredAt` is absent we deliberately make
 * the key un-collidable: processing an event twice is harmless (every write is
 * an idempotent upsert), whereas wrongly collapsing two distinct edits loses
 * one — so the failure direction has to be "twice", never "dropped".
 */
export async function enqueueJobberWebhookEvent(event: {
  topic: string
  itemId: string
  companyId: string
  occurredAt: string | null
}): Promise<boolean> {
  const { topic, itemId, companyId, occurredAt } = event
  const dedupeKey = `${companyId}:${topic}:${itemId}:${occurredAt ?? `nots-${Date.now()}-${Math.random()}`}`

  const admin = createAdminClient()
  const { error } = await admin
    .from('jobber_webhook_events')
    .upsert(
      {
        company_id: companyId,
        topic,
        item_id: itemId,
        occurred_at: occurredAt,
        dedupe_key: dedupeKey,
        status: 'pending',
        next_attempt_at: new Date().toISOString(),
      },
      { onConflict: 'dedupe_key', ignoreDuplicates: true },
    )

  if (error) {
    // Enqueue is the durability guarantee — if it fails there is nothing to fall
    // back on, so make it loud. The caller returns non-2xx so Jobber retries.
    console.error('[jobber-queue] enqueue failed', topic, itemId, error.message)
    return false
  }
  return true
}

type DrainResult = { claimed: number; processed: number; coalesced: number; retried: number; deadLettered: number }

/**
 * Claim and process a batch. Safe to run concurrently — the claim is atomic
 * (FOR UPDATE SKIP LOCKED), so the post-ack kick and the cron never collide on
 * the same event.
 */
export async function drainJobberWebhookQueue(limit = DRAIN_BATCH_SIZE): Promise<DrainResult> {
  const admin = createAdminClient()
  const result: DrainResult = { claimed: 0, processed: 0, coalesced: 0, retried: 0, deadLettered: 0 }

  const { data: claimed, error } = await admin.rpc('claim_jobber_webhook_events', { p_limit: limit })
  if (error) {
    console.error('[jobber-queue] claim failed:', error.message)
    return result
  }
  const rows = (claimed ?? []) as JobberWebhookEventRow[]
  if (rows.length === 0) return result
  result.claimed = rows.length

  // Coalesce exact repeats within the batch. Jobber fires ~4 INVOICE_UPDATE
  // events for a single invoice edit; processing each one re-fetches the same
  // record from the API for an identical result. Keyed on topic as well as item
  // so genuinely different handling (VISIT_UPDATE vs VISIT_COMPLETE, which also
  // writes a pesticide record) is never collapsed together.
  const groups = new Map<string, JobberWebhookEventRow[]>()
  for (const row of rows) {
    const key = `${row.company_id}:${row.topic}:${row.item_id}`
    const g = groups.get(key)
    if (g) g.push(row)
    else groups.set(key, [row])
  }

  const nowIso = () => new Date().toISOString()
  const deadLetteredByCompany = new Map<string, number>()

  for (const group of groups.values()) {
    // Newest wins: it reflects the latest state, and the fetch is by id anyway.
    const [primary, ...duplicates] = [...group].sort((a, b) =>
      (b.occurred_at ?? '').localeCompare(a.occurred_at ?? ''),
    )

    try {
      await processJobberWebhookEvent({
        topic: primary.topic,
        itemId: primary.item_id,
        companyId: primary.company_id,
        occurredAt: primary.occurred_at,
      })

      const doneIds = [primary.id, ...duplicates.map(d => d.id)]
      await admin
        .from('jobber_webhook_events')
        .update({ status: 'done', last_error: null, updated_at: nowIso() })
        .in('id', doneIds)

      result.processed += 1
      result.coalesced += duplicates.length
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)

      // The duplicates go back to pending rather than failing with the primary —
      // if the primary is dead-lettered they still deserve their own attempts.
      if (duplicates.length) {
        await admin
          .from('jobber_webhook_events')
          .update({ status: 'pending', next_attempt_at: nowIso(), updated_at: nowIso() })
          .in('id', duplicates.map(d => d.id))
      }

      if (primary.attempts >= MAX_ATTEMPTS) {
        await admin
          .from('jobber_webhook_events')
          .update({ status: 'failed', last_error: msg, updated_at: nowIso() })
          .eq('id', primary.id)
        result.deadLettered += 1
        deadLetteredByCompany.set(
          primary.company_id,
          (deadLetteredByCompany.get(primary.company_id) ?? 0) + 1,
        )
        console.error(
          `[jobber-queue] DEAD-LETTER ${primary.topic} ${primary.item_id} after ${primary.attempts} attempts: ${msg}`,
        )
      } else {
        const delay = backoffSeconds(primary.attempts)
        await admin
          .from('jobber_webhook_events')
          .update({
            status: 'pending',
            last_error: msg,
            next_attempt_at: new Date(Date.now() + delay * 1000).toISOString(),
            updated_at: nowIso(),
          })
          .eq('id', primary.id)
        result.retried += 1
        console.warn(
          `[jobber-queue] retry ${primary.topic} ${primary.item_id} in ${delay}s (attempt ${primary.attempts}): ${msg}`,
        )
      }
    }
  }

  // One alert per drain per company, not one per event — a token outage
  // dead-letters a burst at once and shouldn't spam the admins' DMs.
  for (const [companyId, count] of deadLetteredByCompany) {
    await notifyJobberSyncFailure(
      companyId,
      `${count} Jobber webhook event${count === 1 ? '' : 's'} could not be processed after ${MAX_ATTEMPTS} attempts and ${count === 1 ? 'was' : 'were'} set aside. ` +
        `The mirror may be missing those changes until the next full sync. ` +
        `Inspect: select topic, item_id, last_error from jobber_webhook_events where status = 'failed' order by created_at desc;`,
    ).catch(err => console.error('[jobber-queue] dead-letter alert failed:', err))
  }

  console.log('[jobber-queue] drain', JSON.stringify(result))
  return result
}
