/**
 * Tombstone mirror rows for records that no longer exist in Jobber.
 *
 * The webhook already soft-deletes on JOB_DESTROY, but an event that never arrived
 * leaves the row behind forever — the sync is otherwise upsert-only, so nothing
 * ever notices. Thirteen deleted jobs were found still sitting in the mirror as
 * OPEN work, which quietly inflates anything that counts open jobs: scoreboards,
 * route capacity, reports. Same shape as the July line-item orphans.
 *
 * Detection asks Jobber about specific ids rather than enumerating what it has.
 * That matters: `jobs(filter: { ids: [...] })` returns ARCHIVED jobs (verified
 * against two known archived records), so "absent from the response" means deleted
 * and not merely finished. Enumerating Jobber's jobs and diffing would have risked
 * tombstoning every archived job we hold.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { companyJobberUserId, jobberGraphQLAdmin } from '@/lib/jobber'
import { fetchAllRows } from '@/lib/email-contacts'

const BATCH = 100
const PACE_MS = 300

const EXISTS_QUERY = `
  query JobsExist($ids: [EncodedId!]) {
    jobs(first: 100, filter: { ids: $ids }) { nodes { id } }
  }
`

type ExistsResponse = { jobs?: { nodes?: { id: string }[] } }

/**
 * @param apply false (the default) reports what WOULD be tombstoned and writes
 *              nothing. Deliberately opt-in: this decides that thousands of live
 *              rows are dead, off the back of an external API's answer.
 */
export async function reconcileDeletedJobs(
  companyId: string,
  { apply = false, budgetMs = 180_000 } = {},
): Promise<{ checked: number; missing: number; tombstoned: number; ids: string[]; truncated: boolean }> {
  const admin = createAdminClient()
  const started = Date.now()

  const jobberUserId = await companyJobberUserId(companyId, '')
  if (!jobberUserId) return { checked: 0, missing: 0, tombstoned: 0, ids: [], truncated: false }

  // Paged — this is thousands of rows, well past PostgREST's 1000-row default.
  const rows = await fetchAllRows<{ external_id: string }>(() =>
    admin
      .from('jobs')
      .select('external_id')
      .eq('company_id', companyId)
      .eq('source', 'jobber')
      .is('deleted_at', null)
      .not('external_id', 'is', null),
  )
  const all = [...new Set(rows.map((r) => r.external_id))]

  const missing: string[] = []
  let checked = 0
  let truncated = false

  for (let i = 0; i < all.length; i += BATCH) {
    if (Date.now() - started > budgetMs) { truncated = true; break }
    const batch = all.slice(i, i + BATCH)
    let res: ExistsResponse
    try {
      res = await jobberGraphQLAdmin<ExistsResponse>(jobberUserId, EXISTS_QUERY, { ids: batch })
    } catch (e) {
      // A failed batch must not be read as "all of these are deleted". Skip it;
      // a later run picks it up.
      console.error('[jobber-reconcile] batch failed, skipping:', e instanceof Error ? e.message : e)
      continue
    }
    const present = new Set((res?.jobs?.nodes ?? []).map((n) => n.id))
    for (const id of batch) if (!present.has(id)) missing.push(id)
    checked += batch.length
    await new Promise((r) => setTimeout(r, PACE_MS))
  }

  let tombstoned = 0
  if (apply && missing.length) {
    for (let i = 0; i < missing.length; i += 200) {
      const slice = missing.slice(i, i + 200)
      const { error } = await admin
        .from('jobs')
        .update({ deleted_at: new Date().toISOString() })
        .eq('company_id', companyId)
        .eq('source', 'jobber')
        .is('deleted_at', null)
        .in('external_id', slice)
      if (error) console.error('[jobber-reconcile] tombstone failed:', error.message)
      else tombstoned += slice.length
    }
  }

  return { checked, missing: missing.length, tombstoned, ids: missing.slice(0, 50), truncated }
}
