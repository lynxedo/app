// Email Marketing — Session 2 contact-list helpers: CSV parsing, Mailchimp
// import (dedupe-on-email + merge), and the Jobber -> email_contacts reconcile.
// Kept decoupled from lib/jobber-sync.ts so the live nightly sync is untouched.
import type { SupabaseClient } from '@supabase/supabase-js'

type Admin = SupabaseClient<any, any, any>

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

// Mailchimp's TAGS cell is comma-separated within a single (quoted) field.
function splitTags(cell: string | undefined): string[] {
  if (!cell) return []
  return cell.split(',').map(t => t.trim()).filter(Boolean)
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
  await admin.from('email_contacts')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('company_id', companyId).eq('email', e)
  return true
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

  if (listType === 'subscribed') {
    // Which emails already exist (from a prior import or the Jobber reconcile)?
    const existing = new Set<string>()
    for (const part of chunk(emails, 300)) {
      const { data } = await admin.from('email_contacts').select('email').eq('company_id', companyId).in('email', part)
      for (const row of data ?? []) existing.add((row.email as string).toLowerCase())
    }

    const toInsert = emails
      .filter(e => !existing.has(e))
      .map(e => ({
        company_id: companyId, email: e,
        first_name: byEmail.get(e)!.first, last_name: byEmail.get(e)!.last,
        source: 'import', status: 'subscribed', imported_batch_id: importId,
      }))
    for (const part of chunk(toInsert, 500)) {
      const { error } = await admin.from('email_contacts').insert(part)
      if (!error) created += part.length
    }
    updated = emails.length - toInsert.length

    // Map every email -> contact id, then merge in the Mailchimp tags.
    const idByEmail = new Map<string, string>()
    for (const part of chunk(emails, 300)) {
      const { data } = await admin.from('email_contacts').select('id, email').eq('company_id', companyId).in('email', part)
      for (const row of data ?? []) idByEmail.set((row.email as string).toLowerCase(), row.id as string)
    }
    const tagRows: { contact_id: string; tag: string; source: string }[] = []
    for (const e of emails) {
      const cid = idByEmail.get(e)
      if (!cid) continue
      for (const tag of byEmail.get(e)!.tags) tagRows.push({ contact_id: cid, tag, source: 'mailchimp' })
    }
    for (const part of chunk(tagRows, 500)) {
      await admin.from('email_contact_tags').upsert(part, { onConflict: 'contact_id,tag', ignoreDuplicates: true })
    }
  } else {
    // unsubscribed / cleaned -> suppression list + flip matching contact status.
    const reason = listType === 'unsubscribed' ? 'unsubscribe' : 'bounce'
    const newStatus = listType === 'unsubscribed' ? 'unsubscribed' : 'bounced'

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
    // Reflect the opt-out on any existing audience rows.
    for (const part of chunk(emails, 300)) {
      await admin.from('email_contacts').update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('company_id', companyId).in('email', part)
    }
  }

  await admin.from('email_imports').update({
    created_count: created, updated_count: updated, suppressed_count: suppressed, skipped_count: skipped,
  }).eq('id', importId)

  return { list_type: listType, total_rows: dataRows.length, created, updated, suppressed, skipped, import_id: importId }
}

export type JobberSyncSummary = { scanned: number; created: number; updated: number; tags_added: number }

/**
 * Upsert Jobber clients + their contacts (any with an email) into email_contacts,
 * and mirror their client_tags into email_contact_tags (source 'jobber'). Safe to
 * run repeatedly; dedupes on email. Decoupled from the nightly Jobber sync.
 */
export async function syncJobberContactsToEmailList(admin: Admin, companyId: string): Promise<JobberSyncSummary> {
  // email -> {first,last,jobber_client_id}. Client's own email first, then contacts.
  const byEmail = new Map<string, { first: string | null; last: string | null; jobberClientId: string }>()

  const { data: clients } = await admin
    .from('clients').select('id, email, first_name, last_name, name')
    .eq('company_id', companyId).is('deleted_at', null).not('email', 'is', null)
  for (const c of clients ?? []) {
    const email = normalizeEmail(c.email as string)
    if (!email || byEmail.has(email)) continue
    byEmail.set(email, { first: (c.first_name as string) || null, last: (c.last_name as string) || null, jobberClientId: c.id as string })
  }

  const { data: contacts } = await admin
    .from('contacts').select('client_id, email, first_name, last_name, name')
    .eq('company_id', companyId).is('deleted_at', null).not('email', 'is', null)
  for (const ct of contacts ?? []) {
    const email = normalizeEmail(ct.email as string)
    if (!email || byEmail.has(email) || !ct.client_id) continue
    byEmail.set(email, { first: (ct.first_name as string) || null, last: (ct.last_name as string) || null, jobberClientId: ct.client_id as string })
  }

  const emails = [...byEmail.keys()]
  let created = 0, updated = 0, tagsAdded = 0

  const existing = new Map<string, string>() // email -> contact id
  for (const part of chunk(emails, 300)) {
    const { data } = await admin.from('email_contacts').select('id, email').eq('company_id', companyId).in('email', part)
    for (const row of data ?? []) existing.set((row.email as string).toLowerCase(), row.id as string)
  }

  const toInsert = emails.filter(e => !existing.has(e)).map(e => ({
    company_id: companyId, email: e,
    first_name: byEmail.get(e)!.first, last_name: byEmail.get(e)!.last,
    source: 'jobber', status: 'subscribed', jobber_client_id: byEmail.get(e)!.jobberClientId,
  }))
  for (const part of chunk(toInsert, 500)) {
    const { error } = await admin.from('email_contacts').insert(part)
    if (!error) created += part.length
  }
  // Backfill jobber_client_id on rows that already existed (e.g. from a Mailchimp import).
  for (const e of emails) {
    const id = existing.get(e)
    if (!id) continue
    updated++
    await admin.from('email_contacts').update({ jobber_client_id: byEmail.get(e)!.jobberClientId }).eq('id', id).is('jobber_client_id', null)
  }

  // Mirror client_tags -> email_contact_tags for every Jobber-linked contact.
  const idByEmail = new Map<string, string>()
  for (const part of chunk(emails, 300)) {
    const { data } = await admin.from('email_contacts').select('id, email, jobber_client_id').eq('company_id', companyId).in('email', part)
    for (const row of data ?? []) if (row.jobber_client_id) idByEmail.set((row.email as string).toLowerCase(), row.id as string)
  }
  const clientIdToContactId = new Map<string, string>()
  for (const e of emails) {
    const cid = idByEmail.get(e)
    if (cid) clientIdToContactId.set(byEmail.get(e)!.jobberClientId, cid)
  }
  const clientIds = [...clientIdToContactId.keys()]
  const tagRows: { contact_id: string; tag: string; source: string }[] = []
  for (const part of chunk(clientIds, 200)) {
    const { data: cts } = await admin
      .from('client_tags').select('client_id, tags(name)').in('client_id', part)
    for (const ct of cts ?? []) {
      const contactId = clientIdToContactId.get(ct.client_id as string)
      const tagName = (ct as { tags?: { name?: string } | null }).tags?.name
      if (contactId && tagName) tagRows.push({ contact_id: contactId, tag: tagName, source: 'jobber' })
    }
  }
  for (const part of chunk(tagRows, 500)) {
    const { error } = await admin.from('email_contact_tags').upsert(part, { onConflict: 'contact_id,tag', ignoreDuplicates: true })
    if (!error) tagsAdded += part.length
  }

  return { scanned: emails.length, created, updated, tags_added: tagsAdded }
}
