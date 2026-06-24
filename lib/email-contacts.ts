// Email Marketing contact-list helpers: CSV parsing, Mailchimp import, and the
// email-audience query. As of the Contacts Directory work (Hub/CRM_CONTACTS_PRD.md)
// these read/write the ONE unified directory table (txt_contacts) — Email is just
// the "has an email + subscribed" filtered view of it. The standalone
// email_contacts / email_contact_tags tables are retired; email_suppressions +
// email_imports stay (suppression ledger + import audit trail).
import type { SupabaseClient } from '@supabase/supabase-js'

type Admin = SupabaseClient<any, any, any>

// The directory (CRM core) lives in this table; "Contacts" is its user-facing name.
const DIRECTORY = 'txt_contacts'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const e = raw.trim().toLowerCase()
  return EMAIL_RE.test(e) ? e : null
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// Minimal RFC-4180 CSV parser: quoted fields, embedded commas/newlines, "" escapes, BOM, CRLF.
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

// Mailchimp's TAGS cell is comma-separated within a single (quoted) field, and
// each tag is often itself wrapped in double quotes — strip those so labels
// don't end up like "12V" (with literal quote chars).
function splitTags(cell: string | undefined): string[] {
  if (!cell) return []
  return cell.split(',').map(t => t.trim().replace(/^"+|"+$/g, '').trim()).filter(Boolean)
}

/**
 * Add an email to the company suppression list (idempotent) and flip any
 * matching audience row's status. Used by unsubscribe + bounce/complaint paths.
 */
export async function suppressEmail(
  admin: Admin,
  companyId: string,
  email: string,
  reason: 'unsubscribe' | 'bounce' | 'complaint' | 'manual',
): Promise<boolean> {
  const e = normalizeEmail(email)
  if (!e) return false
  const { error } = await admin.from('email_suppressions').insert({ company_id: companyId, email: e, reason })
  if (error && error.code !== '23505') return false // 23505 = already suppressed
  const status = reason === 'unsubscribe' ? 'unsubscribed' : reason === 'complaint' ? 'complained' : reason === 'bounce' ? 'bounced' : 'unsubscribed'
  // Flip the directory contact's email status (case-insensitive on email).
  await admin.from(DIRECTORY)
    .update({ email_status: status, updated_at: new Date().toISOString() })
    .eq('company_id', companyId).ilike('email', e)
  return true
}

/**
 * Find-or-create unified tag definitions by label and assign them to directory
 * contacts. Used by the Mailchimp import so Mailchimp TAGS land in the same tag
 * system as every other tool (contact_tags + contact_tag_assignments).
 */
async function applyDirectoryTags(
  admin: Admin,
  companyId: string,
  pairs: { contactId: string; label: string }[],
): Promise<void> {
  if (pairs.length === 0) return
  const labels = [...new Set(pairs.map(p => p.label))]
  const idByLabel = new Map<string, string>()
  // Load existing defs.
  const { data: existing } = await admin
    .from('contact_tags').select('id, label').eq('company_id', companyId)
  for (const t of existing ?? []) idByLabel.set((t.label as string).toLowerCase(), t.id as string)
  // Create the missing ones.
  const missing = labels.filter(l => !idByLabel.has(l.toLowerCase()))
  for (const part of chunk(missing, 200)) {
    const { data } = await admin
      .from('contact_tags')
      .upsert(part.map(label => ({ company_id: companyId, label })), { onConflict: 'company_id,label' })
      .select('id, label')
    for (const t of data ?? []) idByLabel.set((t.label as string).toLowerCase(), t.id as string)
  }
  const assignments = pairs
    .map(p => ({ contact_id: p.contactId, tag_id: idByLabel.get(p.label.toLowerCase()) }))
    .filter((a): a is { contact_id: string; tag_id: string } => !!a.tag_id)
  for (const part of chunk(assignments, 500)) {
    await admin.from('contact_tag_assignments').upsert(part, { onConflict: 'contact_id,tag_id', ignoreDuplicates: true })
  }
}

export type EmailAudienceRow = { id: string; email: string; first_name: string | null; last_name: string | null; name: string }

// PostgREST caps a single response at ~1000 rows, so a plain .select() silently
// truncates large result sets (Heroes' audience is ~1,400). Page through with
// .range() until a short page comes back. `build` must return a FRESH query each
// call (a PostgREST builder is single-use) and impose a stable .order() so pages
// don't overlap or skip.
export async function fetchAllRows<T>(build: () => any, pageSize = 1000): Promise<T[]> {
  const out: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await build().range(from, from + pageSize - 1)
    if (error || !data || data.length === 0) break
    out.push(...(data as T[]))
    if (data.length < pageSize) break
    from += pageSize
  }
  return out
}

/**
 * The send audience = directory contacts that have an email, are subscribed, and
 * are not on the suppression ledger. This is the canonical "who gets an email"
 * query for the Session 3+ campaign sender. Paginated — never truncates the list.
 */
export async function getEmailAudience(admin: Admin, companyId: string): Promise<EmailAudienceRow[]> {
  const rows = await fetchAllRows<EmailAudienceRow>(() => admin
    .from(DIRECTORY)
    .select('id, email, first_name, last_name, name')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .eq('email_status', 'subscribed')
    .not('email', 'is', null)
    .order('id', { ascending: true }))
  if (rows.length === 0) return []
  const sup = await fetchAllRows<{ email: string }>(() => admin
    .from('email_suppressions').select('email').eq('company_id', companyId)
    .order('email', { ascending: true }))
  const suppressed = new Set(sup.map(s => (s.email as string).toLowerCase()))
  return rows.filter(r => r.email && !suppressed.has(r.email.toLowerCase()))
}

export type ImportSummary = {
  list_type: 'subscribed' | 'unsubscribed' | 'cleaned'
  total_rows: number
  created: number
  updated: number
  suppressed: number
  skipped: number
  import_id: string
}

/**
 * Import one Mailchimp CSV export (subscribed / unsubscribed / cleaned). List
 * type is auto-detected from the header. Subscribed rows upsert into
 * email_contacts (dedupe-on-email, merge tags); unsubscribed/cleaned rows go to
 * email_suppressions (and flip the matching contact's status). All counts are
 * recorded in an email_imports audit row.
 */
export async function importMailchimpCsv(
  admin: Admin,
  opts: { companyId: string; userId: string; filename: string; csvText: string },
): Promise<ImportSummary> {
  const { companyId, userId, filename } = opts
  const rows = parseCsv(opts.csvText).filter(r => r.some(c => c.trim() !== ''))
  const header = rows[0] ?? []
  const dataRows = rows.slice(1)

  const idx = (name: string) => header.indexOf(name)
  const emailIdx = idx('Email Address')
  const firstIdx = idx('First Name')
  const lastIdx = idx('Last Name')
  const tagsIdx = idx('TAGS')

  const listType: ImportSummary['list_type'] =
    header.includes('UNSUB_TIME') ? 'unsubscribed' : header.includes('CLEAN_TIME') ? 'cleaned' : 'subscribed'

  // Create the audit row first so new contacts can stamp imported_batch_id.
  const { data: imp } = await admin
    .from('email_imports')
    .insert({ company_id: companyId, filename, source: 'mailchimp', list_type: listType, created_by: userId, total_rows: dataRows.length })
    .select('id').single()
  const importId = imp!.id as string

  let created = 0, updated = 0, suppressed = 0, skipped = 0

  // Collapse the file to one entry per email (last row wins).
  const byEmail = new Map<string, { first: string | null; last: string | null; tags: string[] }>()
  for (const r of dataRows) {
    const email = normalizeEmail(emailIdx >= 0 ? r[emailIdx] : undefined)
    if (!email) { skipped++; continue }
    byEmail.set(email, {
      first: (firstIdx >= 0 ? r[firstIdx] : '')?.trim() || null,
      last: (lastIdx >= 0 ? r[lastIdx] : '')?.trim() || null,
      tags: tagsIdx >= 0 ? splitTags(r[tagsIdx]) : [],
    })
  }
  const emails = [...byEmail.keys()]

  // Every list type populates the master audience with the right status, so the
  // numbers reconcile (subscribed + unsubscribed + bounced). unsubscribed/cleaned
  // ALSO go on the suppression list (the actual send-time gate).
  const newStatus = listType === 'subscribed' ? 'subscribed' : listType === 'unsubscribed' ? 'unsubscribed' : 'bounced'

  // Load the directory's existing emails once (case-insensitive: stored emails
  // may be mixed-case; the unique key is on lower(email)).
  const idByEmail = new Map<string, string>() // lower(email) -> directory contact id
  {
    const { data } = await admin.from(DIRECTORY)
      .select('id, email').eq('company_id', companyId).not('email', 'is', null)
    for (const row of data ?? []) idByEmail.set((row.email as string).toLowerCase(), row.id as string)
  }
  const preExisting = new Set(emails.filter(e => idByEmail.has(e)))

  // Insert brand-new contacts as email-only directory rows. No texting consent
  // came with a Mailchimp import, so do_not_text = true (keeps them out of every
  // texting surface; they have no phone anyway).
  const toInsert = emails.filter(e => !preExisting.has(e)).map(e => {
    const v = byEmail.get(e)!
    const nm = [v.first, v.last].filter(Boolean).join(' ').trim() || e
    return {
      company_id: companyId, name: nm, first_name: v.first, last_name: v.last,
      email: e, email_status: newStatus, phone: null, do_not_text: true,
      sources: ['import'], manually_edited: false,
    }
  })
  for (const part of chunk(toInsert, 500)) {
    const { data, error } = await admin.from(DIRECTORY).insert(part).select('id, email')
    if (!error) {
      created += part.length
      for (const row of data ?? []) idByEmail.set((row.email as string).toLowerCase(), row.id as string)
    }
  }

  // Existing rows: only an unsubscribed/cleaned import flips status — a subscribed
  // import must NOT resurrect someone who opted out. (Suppression ledger is the
  // hard send-time gate regardless.)
  const existingEmails = [...preExisting]
  updated = existingEmails.length
  if (listType !== 'subscribed') {
    const existingIds = existingEmails.map(e => idByEmail.get(e)!).filter(Boolean)
    for (const part of chunk(existingIds, 300)) {
      await admin.from(DIRECTORY).update({ email_status: newStatus, updated_at: new Date().toISOString() }).in('id', part)
    }
  }

  // Merge Mailchimp TAGS into the unified tag system (contact_tags + assignments).
  const tagPairs: { contactId: string; label: string }[] = []
  for (const e of emails) {
    const cid = idByEmail.get(e)
    if (!cid) continue
    for (const tag of byEmail.get(e)!.tags) tagPairs.push({ contactId: cid, label: tag })
  }
  await applyDirectoryTags(admin, companyId, tagPairs)

  // unsubscribed / cleaned -> suppression list (idempotent).
  if (listType !== 'subscribed') {
    const reason = listType === 'unsubscribed' ? 'unsubscribe' : 'bounce'
    const alreadySuppressed = new Set<string>()
    for (const part of chunk(emails, 300)) {
      const { data } = await admin.from('email_suppressions').select('email').eq('company_id', companyId).in('email', part)
      for (const row of data ?? []) alreadySuppressed.add((row.email as string).toLowerCase())
    }
    const toSuppress = emails.filter(e => !alreadySuppressed.has(e)).map(e => ({ company_id: companyId, email: e, reason }))
    for (const part of chunk(toSuppress, 500)) {
      const { error } = await admin.from('email_suppressions').insert(part)
      if (!error) suppressed += part.length
    }
  }

  await admin.from('email_imports').update({
    created_count: created, updated_count: updated, suppressed_count: suppressed, skipped_count: skipped,
  }).eq('id', importId)

  return { list_type: listType, total_rows: dataRows.length, created, updated, suppressed, skipped, import_id: importId }
}

export type JobberSyncSummary = { scanned: number; created: number; updated: number; tags_added: number }

/**
 * Reconcile Jobber clients-with-email into the directory (idempotent). The bulk
 * backfill + (Phase 2) the nightly Jobber cron are the primary feed; this manual
 * "Sync from Jobber" button just surfaces any new Jobber email contacts that
 * aren't in the directory yet. New rows are email-only (phone null) + do_not_text
 * = true so this can never collide on phone or make anyone textable; the cron
 * attaches phones. Existing rows get their Jobber link backfilled.
 */
export async function syncJobberContactsToEmailList(admin: Admin, companyId: string): Promise<JobberSyncSummary> {
  // email -> {first,last, jobber external_id (GID, matches directory convention)}
  const byEmail = new Map<string, { first: string | null; last: string | null; gid: string | null }>()

  const { data: clients } = await admin
    .from('clients').select('external_id, email, first_name, last_name, name')
    .eq('company_id', companyId).is('deleted_at', null).not('email', 'is', null)
  for (const c of clients ?? []) {
    const email = normalizeEmail(c.email as string)
    if (!email || byEmail.has(email)) continue
    byEmail.set(email, { first: (c.first_name as string) || null, last: (c.last_name as string) || null, gid: (c.external_id as string) || null })
  }

  const emails = [...byEmail.keys()]
  let created = 0, updated = 0

  // Existing directory emails (case-insensitive).
  const existing = new Map<string, string>() // lower(email) -> directory contact id
  {
    const { data } = await admin.from(DIRECTORY).select('id, email, jobber_client_id').eq('company_id', companyId).not('email', 'is', null)
    for (const row of data ?? []) existing.set((row.email as string).toLowerCase(), row.id as string)
  }

  const toInsert = emails.filter(e => !existing.has(e)).map(e => {
    const v = byEmail.get(e)!
    const nm = [v.first, v.last].filter(Boolean).join(' ').trim() || e
    return {
      company_id: companyId, name: nm, first_name: v.first, last_name: v.last,
      email: e, email_status: 'subscribed', phone: null, do_not_text: true,
      jobber_client_id: v.gid, sources: ['jobber'], manually_edited: false,
    }
  })
  for (const part of chunk(toInsert, 500)) {
    const { error } = await admin.from(DIRECTORY).insert(part)
    if (!error) created += part.length
  }
  // Backfill the Jobber link on rows that already existed without one.
  for (const e of emails) {
    const id = existing.get(e)
    const gid = byEmail.get(e)!.gid
    if (!id || !gid) continue
    updated++
    await admin.from(DIRECTORY).update({ jobber_client_id: gid }).eq('id', id).is('jobber_client_id', null)
  }

  return { scanned: emails.length, created, updated, tags_added: 0 }
}
