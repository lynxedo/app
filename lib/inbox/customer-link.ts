import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

/** The directory contact an inbox thread is about — the target of the
 *  "Customer file" link on the thread header. */
export type ThreadCustomer = {
  contactId: string
  name: string | null
  email: string | null
}

type ThreadShape = {
  contact_id?: string | null
  from_email?: string | null
  participants?: unknown
}

// Deliberately strict, and applied to the LOWERCASED address: a participant
// address is attacker-supplied (anyone can craft a From header), and these
// values become PostgREST filter values. Rejecting whitespace, commas, angle
// brackets and parens keeps a hostile display-name-ish string out of the query
// entirely rather than relying on escaping downstream.
const EMAIL_RE = /^[^\s@,()<>"';\\]+@[^\s@,()<>"';\\]+\.[^\s@,()<>"';\\]+$/

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1)
}

/** Pull every email address named on the thread (participants + the sender). */
function threadEmails(thread: ThreadShape): string[] {
  const out: string[] = []
  const parts = Array.isArray(thread.participants) ? thread.participants : []
  for (const p of parts) {
    if (p && typeof p === 'object') {
      const e = (p as Record<string, unknown>).email
      if (typeof e === 'string') out.push(e)
    }
  }
  if (typeof thread.from_email === 'string') out.push(thread.from_email)
  return out
}

/** Our own mail identity: the connected mailbox addresses and their domains. */
async function ourIdentity(admin: Admin, companyId: string) {
  const { data } = await admin
    .from('inbox_accounts')
    .select('email_address')
    .eq('company_id', companyId)
  const addresses = new Set<string>()
  const domains = new Set<string>()
  for (const a of (data ?? []) as { email_address: string | null }[]) {
    const e = (a.email_address || '').toLowerCase().trim()
    if (!e || !e.includes('@')) continue
    addresses.add(e)
    domains.add(domainOf(e))
  }
  return { addresses, domains }
}

/** Is this address us — the mailbox itself, or a colleague on our own domain? */
function isInternal(email: string | null | undefined, own: { addresses: Set<string>; domains: Set<string> }): boolean {
  const e = (email || '').toLowerCase().trim()
  if (!e || !e.includes('@')) return false
  return own.addresses.has(e) || own.domains.has(domainOf(e))
}

/**
 * Resolve the customer a shared-inbox thread is with, so the thread can link
 * to that customer's file in the Hub.
 *
 * Two sources, in order:
 *   1. `inbox_threads.contact_id` — the link the sync writes. It only ever
 *      matches the SENDER's address, so it is absent on every thread we started
 *      and on anything that arrived before the contact existed (215 of 6,725
 *      live threads carry one).
 *   2. The thread's outside addresses matched against the directory. Derived
 *      per read rather than stored, so it stays correct as the directory grows
 *      and needs no backfill.
 *
 * ⚠ Both sources are filtered through `isInternal`, and that filter is what
 * makes this correct rather than merely populated. Staff addresses are
 * themselves rows in the contacts directory, so a thread of internally
 * forwarded lead notifications ("New Phone Call from …", sent staff-to-staff)
 * matches a COLLEAGUE and would offer their contact record as the customer.
 * Measured on live data: matching any non-mailbox participant resolves 1,170
 * threads, but only 470 are a genuine outside contact — the other ~700 were
 * staff. 29 of the 215 stored `contact_id`s point at a colleague too, which is
 * why the filter is applied to the stored link as well and not just to the
 * fallback.
 *
 * Only 5 directory contacts sit on the company's own domain, so excluding the
 * whole domain costs nothing real and is far more robust than listing staff.
 *
 * Returns null when nothing matches — the right outcome for the vendor,
 * newsletter and internal traffic that fills a shared mailbox.
 */
export async function resolveThreadCustomer(
  admin: Admin,
  companyId: string,
  thread: ThreadShape
): Promise<ThreadCustomer | null> {
  const own = await ourIdentity(admin, companyId)

  // 1. The stored link, when the sync managed to make a genuine one.
  if (thread.contact_id) {
    const { data } = await admin
      .from('txt_contacts')
      .select('id, name, email')
      .eq('id', thread.contact_id)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .maybeSingle()
    // A contact with no email at all is kept: it can't be judged internal, and
    // the link was made deliberately. A stale or internal one falls through.
    if (data && !isInternal(data.email, own)) {
      return { contactId: data.id as string, name: data.name ?? null, email: data.email ?? null }
    }
  }

  // 2. Outside addresses on the thread → directory.
  const seen = new Set<string>()
  const candidates: { lower: string; raw: string }[] = []
  for (const raw of threadEmails(thread)) {
    const lower = raw.toLowerCase().trim()
    if (!lower || seen.has(lower)) continue
    if (isInternal(lower, own)) continue
    if (!EMAIL_RE.test(lower)) continue
    seen.add(lower)
    candidates.push({ lower, raw: raw.trim() })
    if (candidates.length >= 8) break // a long cc list shouldn't grow the query unboundedly
  }
  if (candidates.length === 0) return null

  // Exact-equality `.in()` rather than a case-insensitive `ilike`: an ilike
  // pattern treats `_` as a wildcard and 61 directory emails contain one, so a
  // near-miss address could resolve to the WRONG customer's file. Both the
  // lowercased and as-received spellings are offered, which covers the 39
  // mixed-case rows in the directory. A casing we don't try just yields no
  // link — it can never yield a wrong one.
  const variants = [...new Set(candidates.flatMap((c) => [c.lower, c.raw]))]
  const { data: matches } = await admin
    .from('txt_contacts')
    .select('id, name, email, in_directory')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .in('email', variants)
    .limit(10)

  const rows = ((matches ?? []) as { id: string; name: string | null; email: string | null; in_directory: boolean | null }[])
    .filter((r) => !isInternal(r.email, own))
  if (rows.length === 0) return null

  // On an inbound thread the sender IS the counterpart, so prefer them; then a
  // real directory member over a hidden stub.
  const fromLower = (thread.from_email || '').toLowerCase().trim()
  const best =
    rows.find((r) => (r.email || '').toLowerCase().trim() === fromLower) ??
    rows.find((r) => r.in_directory !== false) ??
    rows[0]

  return { contactId: best.id, name: best.name ?? null, email: best.email ?? null }
}
