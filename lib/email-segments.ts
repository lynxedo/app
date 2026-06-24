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
import { getEmailAudience, type EmailAudienceRow } from '@/lib/email-contacts'

type Admin = SupabaseClient<any, any, any>

export type SegmentFilter = {
  has_tag?: string[]
  missing_tag?: string[]
  has_line_item?: string[]
  missing_line_item?: string[]
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
  return out
}

export function isEveryone(filter: SegmentFilter): boolean {
  return !(filter.has_tag?.length) && !(filter.missing_tag?.length)
    && !(filter.has_line_item?.length) && !(filter.missing_line_item?.length)
}

// Resolve a single line-item token ("dept:WF" | "name:<exact>") to the set of
// Jobber client GIDs (clients.external_id) whose JOB line items match it. Two
// hops in JS (no SQL joins via PostgREST): line_items(parent_type='job') →
// parent_id (job id) → jobs.clients(external_id).
async function lineItemClientGids(admin: Admin, companyId: string, token: string): Promise<Set<string>> {
  const sep = token.indexOf(':')
  const kind = sep === -1 ? '' : token.slice(0, sep)
  const value = sep === -1 ? '' : token.slice(sep + 1)
  if (!value || (kind !== 'dept' && kind !== 'name')) return new Set()

  let q = admin
    .from('line_items')
    .select('parent_id')
    .eq('company_id', companyId)
    .eq('parent_type', 'job')
    .is('deleted_at', null)
  q = kind === 'dept' ? q.eq('dept_prefix', value) : q.eq('name', value)
  const { data: liRows } = await q.limit(50000)

  const jobIds = [...new Set((liRows ?? []).map(r => r.parent_id as string).filter(Boolean))]
  if (jobIds.length === 0) return new Set()

  const gids = new Set<string>()
  const CHUNK = 100
  for (let i = 0; i < jobIds.length; i += CHUNK) {
    const part = jobIds.slice(i, i + CHUNK)
    const { data: jobRows } = await admin
      .from('jobs')
      .select('clients(external_id)')
      .in('id', part)
    for (const j of jobRows ?? []) {
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

  // ── Line-item filtering (JOB line items only) ───────────────────────────────
  const hasLi = filter.has_line_item ?? []
  const missLi = filter.missing_line_item ?? []
  if ((hasLi.length || missLi.length) && rows.length) {
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
    const hasSets = await Promise.all(hasLi.map(t => lineItemClientGids(admin, companyId, t)))
    const missSets = await Promise.all(missLi.map(t => lineItemClientGids(admin, companyId, t)))
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
