/**
 * Disconnecting a company from Jobber — Servanto Starter Session 2.
 *
 * getservanto.com/privacy promises: when a customer disconnects (from Jobber's
 * side or ours), their Jobber tokens are deleted immediately and the data we
 * copied from Jobber is deleted within 30 days. Reconnecting inside the 30 days
 * cancels the deletion.
 *
 * Heroes is kept out of the deletion (Ben, Oct 31 2026): a disconnect still drops
 * its tokens, but its record gets purge_after = NULL, and the SQL purge function
 * refuses the Heroes company id as a second guard. Only Servanto-app companies
 * are ever purged.
 *
 * The purge itself is purge_company_jobber_data() (supabase/2026-10-31_jobber_disconnects.sql),
 * run nightly by /api/jobber/purge.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { jobberGraphQLAdmin, resolveJobberUserId } from '@/lib/jobber'
import { HEROES_COMPANY_ID, type JobberAppKey } from '@/lib/jobber-apps'

export const JOBBER_DATA_RETENTION_DAYS = 30

export type DisconnectSource = 'jobber_webhook' | 'servanto_button'

/** Whether a company's copied Jobber data is deleted after a disconnect. */
export function purgesOnDisconnect(companyId: string, app: JobberAppKey): boolean {
  return app === 'servanto' && companyId !== HEROES_COMPANY_ID
}

/**
 * Record the disconnect, then delete the company's tokens for that app.
 *
 * Record first: if the token delete then fails the caller returns an error and the
 * whole thing is retried (Jobber redelivers the webhook; the admin clicks again),
 * and a duplicate record is harmless. The other order could lose the record — once
 * the tokens are gone the webhook can't be mapped to the company any more.
 */
export async function recordJobberDisconnect(opts: {
  companyId: string
  app: JobberAppKey
  accountId?: string | null
  source: DisconnectSource
}): Promise<{ ok: boolean; purgeAfter: string | null; error?: string }> {
  const admin = createAdminClient()
  const purgeAfter = purgesOnDisconnect(opts.companyId, opts.app)
    ? new Date(Date.now() + JOBBER_DATA_RETENTION_DAYS * 86_400_000).toISOString()
    : null

  const { error: insErr } = await admin.from('jobber_disconnects').insert({
    company_id: opts.companyId,
    jobber_app: opts.app,
    account_id: opts.accountId ?? null,
    source: opts.source,
    purge_after: purgeAfter,
  })
  if (insErr) return { ok: false, purgeAfter: null, error: insErr.message }

  const { error: delErr } = await admin
    .from('jobber_tokens')
    .delete()
    .eq('company_id', opts.companyId)
    .eq('jobber_app', opts.app)
  if (delErr) return { ok: false, purgeAfter: null, error: delErr.message }

  console.log(
    `[jobber-disconnect] ${opts.companyId} (${opts.app}) via ${opts.source} — tokens deleted, purge ${purgeAfter ?? 'never'}`,
  )
  return { ok: true, purgeAfter }
}

/**
 * Tell Jobber to drop the connection too (our Disconnect button). Best effort:
 * if it fails we still delete our tokens, which leaves the grant unusable.
 */
export async function revokeJobberGrant(companyId: string): Promise<void> {
  try {
    const userId = await resolveJobberUserId(companyId, undefined, { alertIfBroken: false })
    if (!userId) return
    const res = await jobberGraphQLAdmin<{ appDisconnect?: { userErrors?: { message: string }[] } }>(
      userId,
      'mutation { appDisconnect { userErrors { message } } }',
    )
    const errs = res?.appDisconnect?.userErrors ?? []
    if (errs.length) console.warn('[jobber-disconnect] appDisconnect userErrors:', errs.map(e => e.message).join('; '))
  } catch (e) {
    console.warn('[jobber-disconnect] appDisconnect failed (continuing):', e instanceof Error ? e.message : e)
  }
}

/** A reconnect inside the window keeps the data — call from the OAuth callback. */
export async function cancelPendingJobberPurge(companyId: string): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from('jobber_disconnects')
    .update({ purge_cancelled_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .is('purged_at', null)
    .is('purge_cancelled_at', null)
  if (error) console.error('[jobber-disconnect] failed to cancel pending purge:', error.message)
}

/** The scheduled deletion date for a disconnected company, if one is pending. */
export async function pendingJobberPurge(companyId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('jobber_disconnects')
    .select('purge_after')
    .eq('company_id', companyId)
    .is('purged_at', null)
    .is('purge_cancelled_at', null)
    .not('purge_after', 'is', null)
    .order('purge_after', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data?.purge_after as string | undefined) ?? null
}
