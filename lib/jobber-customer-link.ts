/**
 * Writes the "Lynxedo Customer File" link custom field onto Jobber clients.
 *
 * Jobber's link custom field renders as a tappable link on the client and — because
 * the field is created `transferable` — on that client's jobs too, verified in both
 * Jobber web and Jobber Mobile. Tapping it lands a tech on the matching Hub customer
 * page. The value is per client, so it has to be written once per client.
 *
 * The URL stored in Jobber is /j/c/<numeric Jobber client id>, never a Lynxedo
 * contact UUID: the link then survives a contact merge without rewriting ~1,600
 * Jobber records, and app/j/c/[clientId] resolves it (and handles the signed-out
 * case) at tap time.
 *
 * Run as a sweep rather than from the Jobber sync. The sync is a large read-mostly
 * mirror of the whole business, and it cannot see link fields anyway — its
 * CUSTOM_FIELDS_FRAGMENT omits CustomFieldLink, so a value we wrote comes back
 * unlabelled and is dropped. Keeping the writes here means a failure degrades this
 * feature only, and reverting is disabling a cron.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { companyJobberUserId, jobberGraphQLAdmin } from '@/lib/jobber'

/** Yield after this long so a slice always finishes and persists its progress. */
const DEFAULT_BUDGET_MS = 60_000

/** Stop early if Jobber keeps refusing — almost always throttling or a dead token. */
const MAX_CONSECUTIVE_FAILURES = 5

/** What the tech sees as the link text in Jobber. */
const LINK_TEXT = 'Open customer file'

const SET_LINK = `
  mutation SetCustomerFileLink($clientId: EncodedId!, $fieldId: EncodedId!, $text: String!, $url: String!) {
    clientEdit(clientId: $clientId, input: { customFields: [{ customFieldConfigurationId: $fieldId, valueLink: { text: $text, url: $url } }] }) {
      userErrors { message }
    }
  }
`

type SweepResult = {
  companyId: string
  written: number
  failed: number
  remaining: number
  skipped?: string
}

/**
 * Jobber ids are base64 of "gid://Jobber/Client/<n>". We store the encoded form;
 * the URL carries the number, which is short and — unlike base64, whose alphabet
 * includes "/" and "+" — always safe in a path segment.
 */
export function jobberClientNumber(encodedId: string): string | null {
  try {
    const decoded = Buffer.from(encodedId, 'base64').toString('utf8')
    const m = decoded.match(/^gid:\/\/Jobber\/Client\/(\d+)$/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/**
 * The per-company link field id, kept on the Jobber row of the integrations spine.
 *
 * Deliberately NOT auto-created on connect: Jobber refuses to archive a custom field
 * that belongs to an app ("Cannot archive custom field configuration ... because it
 * is associated with an app"), so creating one is effectively permanent for that
 * subscriber. That has to be a deliberate onboarding step, not a side effect.
 */
async function linkConfig(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
): Promise<{ fieldId: string | null; baseUrl: string | null }> {
  const { data } = await admin
    .from('company_integrations')
    .select('config')
    .eq('company_id', companyId)
    .eq('provider', 'jobber')
    .maybeSingle()
  const cfg = (data?.config ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return {
    fieldId: str(cfg.customer_link_field_id),
    baseUrl: str(cfg.customer_link_base_url),
  }
}

/**
 * Write the link for one company's un-written contacts.
 *
 * `limit` caps rows per slice; `budgetMs` caps wall clock. Whichever hits first ends
 * the slice — the cron simply calls again, and the marker column makes that resumable.
 */
export async function sweepCustomerLinks(
  companyId: string,
  { limit = 250, budgetMs = DEFAULT_BUDGET_MS, baseUrl }: { limit?: number; budgetMs?: number; baseUrl?: string } = {},
): Promise<SweepResult> {
  const admin = createAdminClient()
  const started = Date.now()

  const { fieldId, baseUrl: configuredBase } = await linkConfig(admin, companyId)
  if (!fieldId) return { companyId, written: 0, failed: 0, remaining: 0, skipped: 'no_link_field_configured' }

  // The base URL must be CONFIGURED, never inferred from the environment. These
  // URLs are written into Jobber and outlive whichever box wrote them: defaulting
  // to NEXT_PUBLIC_APP_URL meant a sweep run on staging stamped
  // https://staging.lynxedo.com/j/c/... onto live customer records — caught on the
  // first one-record test run, before it reached the other 1,625. Refuse rather
  // than guess.
  const origin = (baseUrl ?? configuredBase ?? '').replace(/\/$/, '')
  if (!origin) return { companyId, written: 0, failed: 0, remaining: 0, skipped: 'no_customer_link_base_url_configured' }

  const jobberUserId = await companyJobberUserId(companyId, '')
  if (!jobberUserId) return { companyId, written: 0, failed: 0, remaining: 0, skipped: 'jobber_not_connected' }

  const { data: rows } = await admin
    .from('txt_contacts')
    .select('id, jobber_client_id')
    .eq('company_id', companyId)
    .not('jobber_client_id', 'is', null)
    .is('jobber_link_set_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  let written = 0
  let failed = 0
  let consecutiveFailures = 0

  for (const row of rows ?? []) {
    if (Date.now() - started > budgetMs) break
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break

    const number = jobberClientNumber(row.jobber_client_id as string)
    if (!number) {
      // Not a client gid we understand. Stamp it so the sweep stops reconsidering
      // it every run — a malformed id will never become writable.
      await admin.from('txt_contacts').update({ jobber_link_set_at: new Date().toISOString() }).eq('id', row.id)
      continue
    }

    try {
      const res = await jobberGraphQLAdmin<{ clientEdit?: { userErrors?: { message: string }[] } }>(
        jobberUserId,
        SET_LINK,
        { clientId: row.jobber_client_id, fieldId, text: LINK_TEXT, url: `${origin}/j/c/${number}` },
      )
      const errs = res?.clientEdit?.userErrors ?? []
      if (errs.length) throw new Error(errs.map((e) => e.message).join('; '))

      await admin.from('txt_contacts').update({ jobber_link_set_at: new Date().toISOString() }).eq('id', row.id)
      written++
      consecutiveFailures = 0
    } catch {
      // Leave the marker null so the next slice retries this contact.
      failed++
      consecutiveFailures++
    }
  }

  const { count } = await admin
    .from('txt_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .not('jobber_client_id', 'is', null)
    .is('jobber_link_set_at', null)

  return { companyId, written, failed, remaining: count ?? 0 }
}

/** Every company that has the link field configured — the cron's work list. */
export async function companiesWithLinkField(): Promise<string[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('company_integrations')
    .select('company_id, config')
    .eq('provider', 'jobber')
  return (data ?? [])
    .filter((r) => {
      const cfg = (r.config ?? {}) as Record<string, unknown>
      // Both halves required — a company with a field but no base URL would be
      // picked up every run only to be skipped, so don't call it configured.
      return (
        typeof cfg.customer_link_field_id === 'string' && cfg.customer_link_field_id &&
        typeof cfg.customer_link_base_url === 'string' && cfg.customer_link_base_url
      )
    })
    .map((r) => r.company_id as string)
}
