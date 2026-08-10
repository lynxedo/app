/**
 * Per-job report links in Jobber.
 *
 * A tech on an irrigation job taps "Start irrigation inspection" in Jobber and lands
 * in the inspection form for that customer. Which jobs qualify is configured, not
 * inferred: an admin maps Jobber line items to a report, because "IR" and "WF" are
 * one company's shorthand and a title-matching rule would only ever work for them.
 *
 * Each report owns its own Jobber link custom field, so a job carrying both
 * irrigation and weed-feed work can show both links — one field holds one URL.
 *
 * Matching reads the line_items mirror rather than asking Jobber, because the sync
 * that precedes this in the webhook has already written them.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { companyJobberUserId, jobberGraphQLAdmin } from '@/lib/jobber'
import { jobberClientNumber } from '@/lib/jobber-customer-link'

const SET_JOB_LINK = `
  mutation SetJobReportLink($jobId: EncodedId!, $fieldId: EncodedId!, $text: String!, $url: String!) {
    jobEdit(jobId: $jobId, input: { customFields: [{ customFieldConfigurationId: $fieldId, valueLink: { text: $text, url: $url } }] }) {
      userErrors { message }
    }
  }
`

export type ReportLink = {
  report_key: string
  label: string
  jobber_field_id: string
  link_text: string
  url_suffix: string
  line_items: string[]
  enabled: boolean
}

export async function getReportLinks(companyId: string): Promise<ReportLink[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('jobber_report_links')
    .select('report_key, label, jobber_field_id, link_text, url_suffix, line_items, enabled')
    .eq('company_id', companyId)
    .eq('enabled', true)
  return (data ?? []) as ReportLink[]
}

/**
 * Put every matching report link on one job.
 *
 * Called from the JOB_CREATE / JOB_UPDATE webhook, after the sync has refreshed the
 * job's line items. Best-effort: returns a summary instead of throwing, so it can
 * never fail the event that triggered it.
 */
export async function writeReportLinksForJob(
  companyId: string,
  jobberJobId: string,
): Promise<{ written: string[]; skipped: string }> {
  const admin = createAdminClient()

  const links = await getReportLinks(companyId)
  if (!links.length) return { written: [], skipped: 'no_reports_configured' }

  // The customer-file link's config carries the public origin these URLs are built
  // from. Same reason as the sweep: never infer it from the environment.
  const { data: integ } = await admin
    .from('company_integrations')
    .select('config')
    .eq('company_id', companyId)
    .eq('provider', 'jobber')
    .maybeSingle()
  const baseUrl = ((integ?.config ?? {}) as Record<string, unknown>).customer_link_base_url
  if (typeof baseUrl !== 'string' || !baseUrl) return { written: [], skipped: 'no_base_url' }

  // The job, its client, and the job's line items — all from the mirror.
  const { data: job } = await admin
    .from('jobs')
    .select('id, client_id')
    .eq('company_id', companyId)
    .eq('external_id', jobberJobId)
    .maybeSingle()
  if (!job) return { written: [], skipped: 'job_not_mirrored' }

  const { data: client } = await admin
    .from('clients')
    .select('external_id')
    .eq('id', job.client_id)
    .maybeSingle()
  const clientNumber = client?.external_id ? jobberClientNumber(client.external_id as string) : null
  if (!clientNumber) return { written: [], skipped: 'no_client' }

  const { data: items } = await admin
    .from('line_items')
    .select('name')
    .eq('company_id', companyId)
    .eq('parent_type', 'job')
    .eq('parent_id', job.id)
    .is('deleted_at', null)
  const present = new Set((items ?? []).map((i) => String(i.name ?? '').trim().toLowerCase()).filter(Boolean))
  if (!present.size) return { written: [], skipped: 'no_line_items' }

  const { data: already } = await admin
    .from('jobber_job_link_writes')
    .select('report_key, url')
    .eq('company_id', companyId)
    .eq('jobber_job_id', jobberJobId)
  const done = new Map((already ?? []).map((r) => [r.report_key as string, r.url as string]))

  const jobberUserId = await companyJobberUserId(companyId, '')
  if (!jobberUserId) return { written: [], skipped: 'jobber_not_connected' }

  const written: string[] = []
  for (const link of links) {
    const matches = link.line_items.some((n) => present.has(n.trim().toLowerCase()))
    if (!matches) continue

    const url = `${baseUrl.replace(/\/$/, '')}/j/c/${clientNumber}${link.url_suffix}`
    // Already correct — skip. Re-writing on every JOB_UPDATE is what trips Jobber's
    // abuse filter, and that blocks the whole credential, not just this feature.
    if (done.get(link.report_key) === url) continue

    try {
      const res = await jobberGraphQLAdmin<{ jobEdit?: { userErrors?: { message: string }[] } }>(
        jobberUserId,
        SET_JOB_LINK,
        { jobId: jobberJobId, fieldId: link.jobber_field_id, text: link.link_text, url },
      )
      const errs = res?.jobEdit?.userErrors ?? []
      if (errs.length) throw new Error(errs.map((e) => e.message).join('; '))

      await admin.from('jobber_job_link_writes').upsert(
        { company_id: companyId, jobber_job_id: jobberJobId, report_key: link.report_key, url, written_at: new Date().toISOString() },
        { onConflict: 'company_id,jobber_job_id,report_key' },
      )
      written.push(link.report_key)
    } catch (e) {
      console.error('[report-link]', link.report_key, jobberJobId, e instanceof Error ? e.message : e)
    }
  }

  return { written, skipped: '' }
}
