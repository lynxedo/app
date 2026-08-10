/**
 * Resumable per-company Jobber backfill.
 *
 * Onboarding a second subscriber was impossible before this: the initial pull took
 * its company from an env var (so only one tenant could ever be synced), the
 * history floor was hardcoded to 2026-01-01, and the whole thing had to finish
 * inside one request — no cursor persistence, so a timeout or deploy meant
 * starting over. Heroes' own pull takes 10–20 minutes; a subscriber with years of
 * history takes hours.
 *
 * The model here is advance-in-slices. Each call works for a bounded time budget,
 * persisting its cursor after every page, then returns. A cron keeps calling until
 * the job reports done. An interrupted run costs one page, never the run.
 *
 * Entities are walked in dependency order (clients → properties → jobs → visits →
 * invoices) so a partially-complete backfill is always internally consistent:
 * a visit never lands before the job it belongs to.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { resolveJobberUserId } from '@/lib/jobber'
import {
  PULL_ENTITIES,
  getJobberSyncStartDate,
  pullJobberEntity,
  type PullEntity,
} from '@/lib/jobber-sync'

/**
 * How long one slice works before yielding. Kept well under the platform's request
 * ceiling: a slice must finish and persist, because a killed request is the one
 * failure mode this design exists to survive.
 */
const DEFAULT_BUDGET_MS = 120_000

/** Give up on an entity after this many consecutive failures and fail the job. */
const MAX_ATTEMPTS = 5

type EntityState = {
  cursor: string | null
  synced: number
  done: boolean
}

type BackfillRow = {
  id: string
  company_id: string
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
  start_date: string
  entities: Record<string, EntityState>
  total_synced: number
  attempts: number
}

export type BackfillProgress = {
  status: BackfillRow['status']
  startDate: string
  totalSynced: number
  entities: Record<string, EntityState>
  /** Entities finished / total — the honest progress signal (see note below). */
  entitiesDone: number
  entitiesTotal: number
  currentEntity: PullEntity | null
  lastError?: string | null
}

function emptyEntities(): Record<string, EntityState> {
  return Object.fromEntries(
    PULL_ENTITIES.map(e => [e, { cursor: null, synced: 0, done: false }]),
  )
}

/**
 * Create or reset a company's backfill.
 *
 * `startDate` defaults to the company's configured sync floor. Resetting an
 * existing job deliberately discards its cursors — the caller asked to start over.
 */
export async function startJobberBackfill(
  companyId: string,
  startDate?: string,
): Promise<BackfillProgress> {
  const admin = createAdminClient()
  const floor = startDate ?? (await getJobberSyncStartDate(companyId))

  const { data, error } = await admin
    .from('jobber_backfill_jobs')
    .upsert(
      {
        company_id: companyId,
        status: 'pending',
        start_date: floor,
        entities: emptyEntities(),
        total_synced: 0,
        attempts: 0,
        last_error: null,
        started_at: new Date().toISOString(),
        completed_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id' },
    )
    .select('*')
    .single()

  if (error) throw new Error(`could not start backfill: ${error.message}`)
  return toProgress(data as BackfillRow, null)
}

/** Read a company's backfill state without touching it. */
export async function getJobberBackfillProgress(companyId: string): Promise<BackfillProgress | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('jobber_backfill_jobs')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle()
  if (!data) return null
  const row = data as BackfillRow & { last_error: string | null }
  return toProgress(row, row.last_error)
}

function toProgress(row: BackfillRow, lastError: string | null): BackfillProgress {
  const entities = row.entities ?? emptyEntities()
  const done = PULL_ENTITIES.filter(e => entities[e]?.done).length
  return {
    status: row.status,
    startDate: row.start_date,
    totalSynced: row.total_synced,
    entities,
    entitiesDone: done,
    entitiesTotal: PULL_ENTITIES.length,
    currentEntity: PULL_ENTITIES.find(e => !entities[e]?.done) ?? null,
    lastError,
  }
}

/**
 * Advance a company's backfill by one time-bounded slice.
 *
 * Safe to call repeatedly and safe to call while one is already running — a slice
 * already in flight holds status 'running', and a second caller returns
 * immediately rather than double-pulling the same cursor.
 *
 * NOTE ON PROGRESS. There is deliberately no percentage. Jobber's connections do
 * expose `totalCount`, but its own docs warn it "raises the likelihood you will be
 * throttled", and a filtered probe needs a correctly-typed filter per entity —
 * exactly the shape of call that has repeatedly 400'd against this API. Rather
 * than ship a denominator that might be wrong or cost us throttling, progress is
 * reported as entities finished plus rows written. A real ETA can come later, once
 * per-entity probe queries have been verified against the live API.
 */
export async function advanceJobberBackfill(
  companyId: string,
  budgetMs = DEFAULT_BUDGET_MS,
): Promise<BackfillProgress & { slice: { pages: number; synced: number; entity: PullEntity | null; yielded: boolean } }> {
  const admin = createAdminClient()
  const deadline = Date.now() + budgetMs

  const { data: existing } = await admin
    .from('jobber_backfill_jobs')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle()

  if (!existing) throw new Error('no backfill for this company — start one first')
  const row = existing as BackfillRow & { last_error: string | null }

  if (row.status === 'completed' || row.status === 'failed') {
    return { ...toProgress(row, row.last_error), slice: { pages: 0, synced: 0, entity: null, yielded: false } }
  }

  // Another slice is mid-flight. Claiming is a plain guarded update rather than a
  // lock: a duplicate slice would re-pull from the same cursor and upsert the same
  // rows — harmless but pure waste, and it would double our Jobber API spend.
  if (row.status === 'running') {
    return { ...toProgress(row, row.last_error), slice: { pages: 0, synced: 0, entity: null, yielded: true } }
  }

  await admin
    .from('jobber_backfill_jobs')
    .update({ status: 'running', updated_at: new Date().toISOString() })
    .eq('id', row.id)

  const entities: Record<string, EntityState> = { ...(row.entities ?? emptyEntities()) }
  for (const e of PULL_ENTITIES) entities[e] ??= { cursor: null, synced: 0, done: false }

  let pages = 0
  let sliceSynced = 0
  let totalSynced = row.total_synced
  let workedOn: PullEntity | null = null
  let yielded = false

  const persist = async (status: BackfillRow['status'], lastError?: string | null) => {
    await admin
      .from('jobber_backfill_jobs')
      .update({
        status,
        entities,
        total_synced: totalSynced,
        ...(lastError !== undefined ? { last_error: lastError } : {}),
        ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
  }

  try {
    const userId = await resolveJobberUserId(companyId)
    if (!userId) throw new Error('no usable Jobber token for this company')

    for (const entity of PULL_ENTITIES) {
      if (entities[entity].done) continue
      if (Date.now() >= deadline) { yielded = true; break }
      workedOn = entity

      await pullJobberEntity(entity, userId, companyId, {
        startDate: row.start_date,
        startCursor: entities[entity].cursor,
        onPage: async (cursor, added, hasMore) => {
          pages += 1
          sliceSynced += added
          totalSynced += added
          entities[entity] = { cursor, synced: entities[entity].synced + added, done: !hasMore }

          // Persist every page — the point of the whole design. Costs one small
          // write per page and buys never having to restart a multi-hour pull.
          await persist('running')

          if (!hasMore) return false          // entity finished
          if (Date.now() >= deadline) {        // out of budget: stop, keep cursor
            yielded = true
            return false
          }
          return true
        },
      })

      // If the pull returned without ever reporting a page, there was nothing to
      // fetch — treat the entity as complete so the job can't stall on it forever.
      if (!entities[entity].done && pages === 0) {
        entities[entity] = { ...entities[entity], done: true }
      }
      if (yielded) break
    }

    const allDone = PULL_ENTITIES.every(e => entities[e].done)
    await persist(allDone ? 'completed' : 'paused', null)

    // Reset the failure counter after any slice that got through cleanly.
    if (row.attempts > 0) {
      await admin.from('jobber_backfill_jobs').update({ attempts: 0 }).eq('id', row.id)
    }

    const fresh = await getJobberBackfillProgress(companyId)
    return {
      ...(fresh ?? toProgress({ ...row, entities, total_synced: totalSynced }, null)),
      slice: { pages, synced: sliceSynced, entity: workedOn, yielded },
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const attempts = row.attempts + 1
    // Cursors written by onPage survive, so a retry resumes rather than restarts.
    await persist(attempts >= MAX_ATTEMPTS ? 'failed' : 'paused', msg)
    await admin.from('jobber_backfill_jobs').update({ attempts }).eq('id', row.id)
    console.error(`[jobber-backfill] ${companyId} slice failed (attempt ${attempts}):`, msg)

    const fresh = await getJobberBackfillProgress(companyId)
    return {
      ...(fresh ?? toProgress({ ...row, entities, total_synced: totalSynced }, msg)),
      slice: { pages, synced: sliceSynced, entity: workedOn, yielded: false },
    }
  }
}

/**
 * Advance every company that has an unfinished backfill — the cron entry point.
 * Sequential on purpose: concurrent slices across tenants would multiply our
 * Jobber API spend and share one rate limit.
 */
export async function advanceAllJobberBackfills(budgetMsEach = DEFAULT_BUDGET_MS): Promise<
  { companyId: string; status: string; synced: number }[]
> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('jobber_backfill_jobs')
    .select('company_id')
    .in('status', ['pending', 'paused'])
    .order('updated_at', { ascending: true })

  const out: { companyId: string; status: string; synced: number }[] = []
  for (const r of (data ?? []) as { company_id: string }[]) {
    try {
      const p = await advanceJobberBackfill(r.company_id, budgetMsEach)
      out.push({ companyId: r.company_id, status: p.status, synced: p.slice.synced })
    } catch (e) {
      console.error('[jobber-backfill] advance failed for', r.company_id, e)
      out.push({ companyId: r.company_id, status: 'error', synced: 0 })
    }
  }
  return out
}
