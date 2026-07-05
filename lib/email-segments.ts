// Email segments = saved filters over the unified Contacts directory. A segment's
// audience starts from getEmailAudience() (directory rows that have an email, are
// subscribed, and aren't suppressed) and is then narrowed by tags AND by the
// Jobber line items a contact's account has purchased.
//
// filter shape (jsonb on email_segments.filter):
//   { has_tag?: string[], missing_tag?: string[],
//     has_line_item?: string[], missing_line_item?: string[] }
//   {}  => everyone (all subscribed, non-suppressed contacts)
//
//   tag entries        = contact_tags.id
//   line_item entries  = tokens "dept:WF" (a department) | "name:<exact line item>"
//
// Semantics: a contact matches when it has EVERY tag in has_tag, NONE in
// missing_tag, its account has EVERY line item in has_line_item, and NONE in
// missing_line_item. Empty/absent arrays impose no constraint.
//
// Line items are matched against JOB line items only (parent_type='job') — Ben's
// call, so we never double-count the same service listed under a job, its visit,
// and its invoice. The contact→account link is the directory's jobber_client_id
// (a Jobber GID = clients.external_id).
import type { SupabaseClient } from '@supabase/supabase-js'
import { getEmailAudience, fetchAllRows, type EmailAudienceRow } from '@/lib/email-contacts'

type Admin = SupabaseClient<any, any, any>

export type SegmentFilter = {
  has_tag?: string[]
  missing_tag?: string[]
  has_line_item?: string[]
  missing_line_item?: string[]
  // Jobber account status. Absent = both. 'active' excludes archived/cancelled
  // customers; 'archived' targets only them (win-back). Contacts with no Jobber
  // link (e.g. Mailchimp imports) count as active.
  account_status?: 'active' | 'archived'
  // When true, a line-item rule ("buys X") counts only CURRENT services — line
  // items on a non-archived job — so a customer who cancelled that service no
  // longer matches. When false/absent, it matches any job they've ever had
  // (historical). Only affects has_line_item / missing_line_item.
  line_item_active_only?: boolean
}

export function normalizeFilter(raw: unknown): SegmentFilter {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const ids = (v: unknown): string[] =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))] : []
  const out: SegmentFilter = {}
  const has = ids(f.has_tag)
  const missing = ids(f.missing_tag)
  const hasLi = ids(f.has_line_item)
  const missingLi = ids(f.missing_line_item)
  if (has.length) out.has_tag = has
  if (missing.length) out.missing_tag = missing
  if (hasLi.length) out.has_line_item = hasLi
  if (missingLi.length) out.missing_line_item = missingLi
  if (f.account_status === 'active' || f.account_status === 'archived') out.account_status = f.account_status
  if (f.line_item_active_only === true) out.line_item_active_only = true
  return out
}

export function isEveryone(filter: SegmentFilter): boolean {
  return !(filter.has_tag?.length) && !(filter.missing_tag?.length)
    && !(filter.has_line_item?.length) && !(filter.missing_line_item?.length)
    && !filter.account_status
}

// All Jobber client GIDs (clients.external_id) currently archived for the company.
async function archivedClientGids(admin: Admin, companyId: string): Promise<Set<string>> {
  const rows = await fetchAllRows<{ external_id: string }>(() => admin
    .from('clients')
    .select('external_id')
    .eq('company_id', companyId)
    .eq('is_archived', true)
    .not('external_id', 'is', null)
    .order('external_id', { ascending: true }))
  return new Set(rows.map(r => r.external_id).filter(Boolean))
}

// Resolve a single line-item token ("dept:WF" | "name:<exact>") to the set of
// Jobber client GIDs (clients.external_id) whose JOB line items match it. Two
// hops in JS (no SQL joins via PostgREST): line_items(parent_type='job') →
// parent_id (job id) → jobs.clients(external_id).
async function lineItemClientGids(admin: Admin, companyId: string, token: string, activeOnly: boolean): Promise<Set<string>> {
  const sep = token.indexOf(':')
  const kind = sep === -1 ? '' : token.slice(0, sep)
  const value = sep === -1 ? '' : token.slice(sep + 1)
  if (!value || (kind !== 'dept' && kind !== 'name')) return new Set()

  // Paged — PostgREST caps any single response at 1,000 rows no matter the
  // .limit(), which silently computed segment membership from a fraction of the
  // line items (incomplete campaign audiences).
  const liRows = await fetchAllRows<{ parent_id: string | null }>(() => {
    const q = admin
      .from('line_items')
      .select('parent_id')
      .eq('company_id', companyId)
      .eq('parent_type', 'job')
      .is('deleted_at', null)
      .order('id', { ascending: true })
    return kind === 'dept' ? q.eq('dept_prefix', value) : q.eq('name', value)
  })

  const jobIds = [...new Set(liRows.map(r => r.parent_id as string).filter(Boolean))]
  if (jobIds.length === 0) return new Set()

  const gids = new Set<string>()
  const CHUNK = 100
  for (let i = 0; i < jobIds.length; i += CHUNK) {
    const part = jobIds.slice(i, i + CHUNK)
    const { data: jobRows } = await admin
      .from('jobs')
      .select('job_status, clients(external_id)')
      .in('id', part)
    for (const j of jobRows ?? []) {
      // "active services only" = ignore line items on archived (ended) jobs, so a
      // cancelled service stops matching. A null status counts as not-archived.
      if (activeOnly && (j as any).job_status === 'archived') continue
      const ext = (j as any).clients?.external_id as string | undefined
      if (ext) gids.add(ext)
    }
  }
  return gids
}

/**
 * Resolve a filter to the matching audience rows. Returns the same row shape as
 * getEmailAudience so callers (preview, campaign sender) treat segment output and
 * "everyone" identically.
 */
export async function resolveSegment(
  admin: Admin,
  companyId: string,
  filter: SegmentFilter,
): Promise<EmailAudienceRow[]> {
  const audience = await getEmailAudience(admin, companyId)
  if (isEveryone(filter) || audience.length === 0) return audience

  let rows = audience

  // ── Tag filtering ──────────────────────────────────────────────────────────
  const relevantTagIds = [...new Set([...(filter.has_tag ?? []), ...(filter.missing_tag ?? [])])]
  if (relevantTagIds.length) {
    const tagsByContact = new Map<string, Set<string>>()
    const contactIds = rows.map(r => r.id)
    const CHUNK = 300
    for (let i = 0; i < contactIds.length; i += CHUNK) {
      const part = contactIds.slice(i, i + CHUNK)
      const { data } = await admin
        .from('contact_tag_assignments')
        .select('contact_id, tag_id')
        .in('contact_id', part)
        .in('tag_id', relevantTagIds)
      for (const row of data ?? []) {
        const cid = row.contact_id as string
        let s = tagsByContact.get(cid)
        if (!s) { s = new Set(); tagsByContact.set(cid, s) }
        s.add(row.tag_id as string)
      }
    }
    const has = filter.has_tag ?? []
    const missing = filter.missing_tag ?? []
    rows = rows.filter(r => {
      const tags = tagsByContact.get(r.id) ?? new Set<string>()
      if (has.length && !has.every(t => tags.has(t))) return false
      if (missing.length && missing.some(t => tags.has(t))) return false
      return true
    })
  }

  // ── Account-status + line-item filtering (both keyed on the Jobber GID) ──────
  const hasLi = filter.has_line_item ?? []
  const missLi = filter.missing_line_item ?? []
  const needGid = (filter.account_status || hasLi.length || missLi.length) && rows.length
  if (needGid) {
    // Map each surviving contact → its Jobber GID (account link), if any.
    const gidByContact = new Map<string, string | null>()
    const ids = rows.map(r => r.id)
    const CHUNK = 300
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = ids.slice(i, i + CHUNK)
      const { data } = await admin
        .from('txt_contacts')
        .select('id, jobber_client_id')
        .in('id', part)
      for (const row of data ?? []) gidByContact.set(row.id as string, (row.jobber_client_id as string) || null)
    }

    // Account status: a contact with no Jobber link counts as active (e.g. a
    // Mailchimp-only marketing contact is not a cancelled customer).
    if (filter.account_status) {
      const archived = await archivedClientGids(admin, companyId)
      rows = rows.filter(r => {
        const gid = gidByContact.get(r.id) ?? null
        const isArchived = gid ? archived.has(gid) : false
        return filter.account_status === 'archived' ? isArchived : !isArchived
      })
    }

    if (hasLi.length || missLi.length) {
      const activeOnly = !!filter.line_item_active_only
      const hasSets = await Promise.all(hasLi.map(t => lineItemClientGids(admin, companyId, t, activeOnly)))
      const missSets = await Promise.all(missLi.map(t => lineItemClientGids(admin, companyId, t, activeOnly)))
      rows = rows.filter(r => {
        const gid = gidByContact.get(r.id) ?? null
        // "has" requires a linked account whose jobs carry every selected line item.
        if (hasLi.length) {
          if (!gid) return false
          if (!hasSets.every(s => s.has(gid))) return false
        }
        // "missing" excludes anyone whose account carries any selected line item.
        if (missLi.length && gid && missSets.some(s => s.has(gid))) return false
        return true
      })
    }
  }

  return rows
}

/** Recipient count + a small sample for the live segment-builder preview. */
export async function previewSegment(
  admin: Admin,
  companyId: string,
  filter: SegmentFilter,
  sampleSize = 5,
): Promise<{ count: number; sample: EmailAudienceRow[] }> {
  const rows = await resolveSegment(admin, companyId, filter)
  return { count: rows.length, sample: rows.slice(0, sampleSize) }
}
