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
import { isAbuseBlock, jobberClientNumber } from '@/lib/jobber-customer-link'
import { fetchAllRows } from '@/lib/email-contacts'

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
): Promise<{ written: string[]; skipped: string; blocked?: boolean }> {
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
  let blocked = false
  for (const link of links) {
    const matches = link.line_items.some((n) => present.has(n.trim().toLowerCase()))
    if (!matches) continue

    const url = `${baseUrl.replace(/\/$/, '')}/j/c/${clientNumber}${link.url_suffix}`
    // Already correct — skip. Re-writing on every JOB_UPDATE is what trips Jobber's
    // abuse filter, and that blocks the whole credential, not just this feature.
    if (done.get(link.report_key) === url) continue

    try {
      const res = await jobberGraphQLAdmin<{ data?: { jobEdit?: { userErrors?: { message: string }[] } } }>(
        jobberUserId,
        SET_JOB_LINK,
        { jobId: jobberJobId, fieldId: link.jobber_field_id, text: link.link_text, url },
      )
      const errs = res?.data?.jobEdit?.userErrors ?? []
      if (errs.length) throw new Error(errs.map((e) => e.message).join('; '))

      await admin.from('jobber_job_link_writes').upsert(
        { company_id: companyId, jobber_job_id: jobberJobId, report_key: link.report_key, url, written_at: new Date().toISOString() },
        { onConflict: 'company_id,jobber_job_id,report_key' },
      )
      written.push(link.report_key)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[report-link]', link.report_key, jobberJobId, msg)
      // Jobber's abuse filter blocks the whole credential. Stop, don't grind on.
      if (isAbuseBlock(msg)) { blocked = true; break }
    }
  }

  return { written, skipped: '', ...(blocked ? { blocked } : {}) }
}

/**
 * One-off backfill: put report links on jobs that already exist.
 *
 * JOB_CREATE / JOB_UPDATE covers everything from here on, but jobs already in
 * Jobber have no event coming. Only a small slice of them matter: of ~2,700 jobs,
 * 686 carry irrigation line items and just 233 of those are still open. A tech
 * never taps a link on archived or already-invoiced work, so completed jobs are
 * skipped — that alone drops 60% of the writes for zero lost value.
 *
 * `completed_at is null` rather than a date window: an old unscheduled job still
 * deserves a link, and a job finished last week does not.
 */
export async function backfillJobReportLinks(
  companyId: string,
  { limit = 400, budgetMs = 120_000 } = {},
): Promise<{ scanned: number; written: number; blocked: boolean; remaining: number }> {
  const admin = createAdminClient()
  const started = Date.now()

  const links = await getReportLinks(companyId)
  const wanted = new Set(
    links.flatMap((l) => l.line_items.map((n) => n.trim().toLowerCase())).filter(Boolean),
  )
  // No line items mapped yet — nothing qualifies, so this is a no-op rather than
  // a scan of every job.
  if (!wanted.size) return { scanned: 0, written: 0, blocked: false, remaining: 0 }

  // Paged: this comfortably exceeds PostgREST's 1000-row default cap, and a silent
  // truncation here would look like "those jobs just don't qualify".
  const rows = await fetchAllRows<{ parent_id: string; name: string }>(() =>
    admin
      .from('line_items')
      .select('parent_id, name')
      .eq('company_id', companyId)
      .eq('parent_type', 'job')
      .is('deleted_at', null),
  )

  const candidateJobIds = [...new Set(
    rows.filter((r) => wanted.has(String(r.name ?? '').trim().toLowerCase())).map((r) => r.parent_id),
  )]
  if (!candidateJobIds.length) return { scanned: 0, written: 0, blocked: false, remaining: 0 }

  // Open jobs only, oldest first so a partial run makes steady forward progress.
  const open: { id: string; external_id: string }[] = []
  for (let i = 0; i < candidateJobIds.length; i += 200) {
    const { data } = await admin
      .from('jobs')
      .select('id, external_id')
      .eq('company_id', companyId)
      .is('completed_at', null)
      .in('id', candidateJobIds.slice(i, i + 200))
    open.push(...((data ?? []) as { id: string; external_id: string }[]))
  }

  // Skip anything already written, so re-running is cheap and safe.
  const done = new Set(
    (await fetchAllRows<{ jobber_job_id: string }>(() =>
      admin.from('jobber_job_link_writes').select('jobber_job_id').eq('company_id', companyId),
    )).map((r) => r.jobber_job_id),
  )
  const todo = open.filter((j) => j.external_id && !done.has(j.external_id))

  let written = 0
  let blocked = false
  let scanned = 0
  for (const job of todo.slice(0, limit)) {
    if (Date.now() - started > budgetMs) break
    scanned++
    const res = await writeReportLinksForJob(companyId, job.external_id)
    written += res.written.length
    if (res.blocked) { blocked = true; break }
  }

  return { scanned, written, blocked, remaining: Math.max(0, todo.length - scanned) }
}
