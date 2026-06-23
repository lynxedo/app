// Email segments = saved filters over the unified Contacts directory. A segment's
// audience starts from getEmailAudience() (directory rows that have an email, are
// subscribed, and aren't suppressed) and is then narrowed by tags.
//
// filter shape (jsonb on email_segments.filter):
//   { has_tag?: string[], missing_tag?: string[] }   -- arrays of contact_tags.id
//   {}  => everyone (all subscribed, non-suppressed contacts)
//
// Semantics: a contact matches when it has EVERY tag in has_tag AND NONE of the
// tags in missing_tag. Empty/absent arrays impose no constraint.
import type { SupabaseClient } from '@supabase/supabase-js'
import { getEmailAudience, type EmailAudienceRow } from '@/lib/email-contacts'

type Admin = SupabaseClient<any, any, any>

export type SegmentFilter = { has_tag?: string[]; missing_tag?: string[] }

export function normalizeFilter(raw: unknown): SegmentFilter {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const ids = (v: unknown): string[] =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))] : []
  const has = ids(f.has_tag)
  const missing = ids(f.missing_tag)
  const out: SegmentFilter = {}
  if (has.length) out.has_tag = has
  if (missing.length) out.missing_tag = missing
  return out
}

export function isEveryone(filter: SegmentFilter): boolean {
  return !(filter.has_tag?.length) && !(filter.missing_tag?.length)
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

  const relevantTagIds = [...new Set([...(filter.has_tag ?? []), ...(filter.missing_tag ?? [])])]
  // Map contact_id -> set of its tag ids (only the tags this filter cares about).
  const tagsByContact = new Map<string, Set<string>>()
  const contactIds = audience.map(r => r.id)
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
  return audience.filter(r => {
    const tags = tagsByContact.get(r.id) ?? new Set<string>()
    if (has.length && !has.every(t => tags.has(t))) return false
    if (missing.length && missing.some(t => tags.has(t))) return false
    return true
  })
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
