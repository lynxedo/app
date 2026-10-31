/**
 * Which Jobber developer app a company connects through.
 *
 * - 'lynxedo'  — the original app (env JOBBER_CLIENT_ID/SECRET). Heroes connected
 *                through it and stays on it: its token was issued to that client,
 *                and moving it would force a reconnect for no benefit.
 * - 'servanto' — the Marketplace app (env SERVANTO_JOBBER_CLIENT_ID/SECRET), owned
 *                by the LynxedoLLC developer account with narrower scopes. Every
 *                other company connects through this one.
 *
 * ⚠ A token is only valid with the client id/secret that issued it — the refresh
 * must use the same app's keys, and Jobber signs each webhook with the issuing
 * app's secret. So the app is stored on the jobber_tokens row (`jobber_app`) and
 * a reconnect keeps whatever the row already says.
 */

import { createAdminClient } from '@/lib/supabase/admin'

export type JobberAppKey = 'lynxedo' | 'servanto'

export interface JobberAppCreds {
  key: JobberAppKey
  clientId: string
  clientSecret: string
}

export const HEROES_COMPANY_ID = '00000000-0000-0000-0000-000000000002'

// Scopes asked for at authorize time. A scope lives in the issued token, so these
// must match what each app has ticked in the Jobber Developer Center.
export const JOBBER_APP_SCOPES: Record<JobberAppKey, string> = {
  // `read_quotes` was added 2026-08-13 — see the note in app/api/auth/jobber/route.ts.
  lynxedo: 'read_clients write_clients read_jobs write_jobs read_visits write_visits read_users read_quotes',
  // The Starter product writes clients + requests (Leads → Jobber) and reads the rest
  // for Reports and Amber. No job/visit writes — Work Orders and routing aren't in it.
  servanto: 'read_clients write_clients read_requests write_requests read_quotes read_jobs read_visits read_invoices read_users',
}

export function jobberAppCreds(key: JobberAppKey): JobberAppCreds | null {
  const clientId = key === 'servanto' ? process.env.SERVANTO_JOBBER_CLIENT_ID : process.env.JOBBER_CLIENT_ID
  const clientSecret = key === 'servanto' ? process.env.SERVANTO_JOBBER_CLIENT_SECRET : process.env.JOBBER_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { key, clientId, clientSecret }
}

/** Every app whose keys are configured here — the webhook accepts a signature from any of them. */
export function configuredJobberApps(): JobberAppCreds[] {
  return (['lynxedo', 'servanto'] as const)
    .map(jobberAppCreds)
    .filter((c): c is JobberAppCreds => c !== null)
}

export function normaliseJobberApp(value: unknown): JobberAppKey {
  return value === 'servanto' ? 'servanto' : 'lynxedo'
}

/**
 * The app a company should (re)connect through:
 * 1. an existing connection keeps its app;
 * 2. Heroes → 'lynxedo';
 * 3. everyone else → 'servanto', falling back to 'lynxedo' while the Servanto keys
 *    aren't configured on this server (so a new tenant can still connect).
 */
export async function jobberAppForCompany(companyId: string): Promise<JobberAppKey> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('jobber_tokens')
    .select('jobber_app')
    .eq('company_id', companyId)
    .maybeSingle()
  if (data?.jobber_app) return normaliseJobberApp(data.jobber_app)
  if (companyId === HEROES_COMPANY_ID) return 'lynxedo'
  return jobberAppCreds('servanto') ? 'servanto' : 'lynxedo'
}
