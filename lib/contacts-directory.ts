// Contacts Directory (CRM core) feed — keeps the unified directory (txt_contacts)
// current from the nightly Jobber sync. See Hub/CRM_CONTACTS_PRD.md §8–9.
//
// Match precedence per client: existing Jobber link → phone (last 10 digits) →
// email; else insert. CONSENT GUARD: a row that is newly created, or that gains
// a phone from this (non-texting) source, is set do_not_text = true; rows that
// already had a phone (i.e. consented texted-in contacts) keep their consent.
// Hand-edited rows (manually_edited) keep their core fields — we only ever fill
// blanks and refresh the Jobber link + tags. Tags mirror Jobber EXACTLY for
// source='jobber' assignments (adds + removals) and never touch manual tags.
import type { SupabaseClient } from '@supabase/supabase-js'

type Admin = SupabaseClient<any, any, any>

export type DirectoryClientInput = {
  external_id: string            // Jobber GID — the directory's jobber_client_id convention
  name: string | null
  first_name: string | null
  last_name: string | null
  company_name: string | null
  is_company: boolean
  email: string | null
  phone: string | null
  tagLabels: string[]
}

function tenDigits(phone: string | null): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  return d.length === 10 || d.length === 11 ? d.slice(-10) : null
}

/** Find-or-create unified tag definitions for the given labels → label(lower)->id. */
async function ensureTagDefs(admin: Admin, companyId: string, labels: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const { data: existing } = await admin.from('contact_tags').select('id, label').eq('company_id', companyId)
  for (const t of existing ?? []) map.set((t.label as string).toLowerCase(), t.id as string)
  const missing = [...new Set(labels)].filter(l => l && !map.has(l.toLowerCase()))
  if (missing.length) {
    const { data } = await admin.from('contact_tags')
      .upsert(missing.map(label => ({ company_id: companyId, label })), { onConflict: 'company_id,label' })
      .select('id, label')
    for (const t of data ?? []) map.set((t.label as string).toLowerCase(), t.id as string)
  }
  return map
}

/**
 * Upsert a page of Jobber clients into the directory + mirror their tags.
 * Best-effort and isolated per client so a single bad row can never fail the
 * surrounding Jobber sync. Returns counts for logging.
 */
export async function syncClientsToDirectory(
  admin: Admin,
  companyId: string,
  items: DirectoryClientInput[],
): Promise<{ inserted: number; enriched: number }> {
  let inserted = 0, enriched = 0
  if (items.length === 0) return { inserted, enriched }

  const allLabels = items.flatMap(i => i.tagLabels)
  const tagIdByLabel = await ensureTagDefs(admin, companyId, allLabels)

  for (const c of items) {
    try {
      const ten = tenDigits(c.phone)
      const e164 = ten ? '+1' + ten : null

      // 1) locate the directory row: jobber link → phone → email
      let existingId: string | null = null
      let existingHasPhone = false
      {
        const { data } = await admin.from('txt_contacts')
          .select('id, phone')
          .eq('company_id', companyId).eq('jobber_client_id', c.external_id).limit(1).maybeSingle()
        if (data) { existingId = data.id as string; existingHasPhone = !!data.phone }
      }
      if (!existingId && ten) {
        const { data } = await admin.from('txt_contacts')
          .select('id, phone')
          .eq('company_id', companyId).in('phone_digits', [ten, '1' + ten]).limit(1).maybeSingle()
        if (data) { existingId = data.id as string; existingHasPhone = !!data.phone }
      }
      if (!existingId && c.email) {
        const { data } = await admin.from('txt_contacts')
          .select('id, phone')
          .eq('company_id', companyId).ilike('email', c.email).limit(1).maybeSingle()
        if (data) { existingId = data.id as string; existingHasPhone = !!data.phone }
      }

      if (existingId) {
        // enrich: refresh Jobber link + fill blanks. Only adopt phone/email when
        // free (no other row owns them) to never break the unique keys.
        const update: Record<string, unknown> = {
          jobber_client_id: c.external_id,
          updated_at: new Date().toISOString(),
        }
        // add 'jobber' to sources
        const { data: cur } = await admin.from('txt_contacts').select('sources, manually_edited, first_name, last_name, company_name, is_company, email, phone').eq('id', existingId).single()
        const sources = Array.from(new Set([...((cur?.sources as string[]) ?? []), 'jobber']))
        update.sources = sources
        if (!cur?.manually_edited) {
          if (!cur?.first_name && c.first_name) update.first_name = c.first_name
          if (!cur?.last_name && c.last_name) update.last_name = c.last_name
          if (!cur?.company_name && c.company_name) update.company_name = c.company_name
          if (c.is_company) update.is_company = true
        }
        // adopt phone if the row has none and it's free → no texting consent
        if (!cur?.phone && e164) {
          const { count } = await admin.from('txt_contacts')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', companyId).in('phone_digits', [ten!, '1' + ten!]).neq('id', existingId)
          if (!count) { update.phone = e164; update.phone_digits = ten; update.do_not_text = true }
        }
        // adopt email if the row has none and it's free
        if (!cur?.email && c.email) {
          const { count } = await admin.from('txt_contacts')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', companyId).ilike('email', c.email).neq('id', existingId)
          if (!count) update.email = c.email
        }
        await admin.from('txt_contacts').update(update).eq('id', existingId)
        enriched++
        void existingHasPhone
      } else {
        const nm = c.name?.trim() || [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.email || 'Unknown'
        const { data, error } = await admin.from('txt_contacts').insert({
          company_id: companyId, name: nm, first_name: c.first_name, last_name: c.last_name,
          company_name: c.company_name, is_company: c.is_company,
          phone: e164, phone_digits: ten, email: c.email, email_status: 'subscribed',
          jobber_client_id: c.external_id, do_not_text: true, sources: ['jobber'], manually_edited: false,
        }).select('id').single()
        if (error || !data) continue
        existingId = data.id as string
        inserted++
      }

      if (!existingId) continue

      // 2) mirror Jobber tags (source='jobber') exactly: add new, drop removed.
      const desired = new Set(c.tagLabels.map(l => tagIdByLabel.get(l.toLowerCase())).filter(Boolean) as string[])
      const { data: cur } = await admin.from('contact_tag_assignments')
        .select('tag_id').eq('contact_id', existingId).eq('source', 'jobber')
      const current = new Set((cur ?? []).map(r => r.tag_id as string))
      const toAdd = [...desired].filter(id => !current.has(id))
      const toRemove = [...current].filter(id => !desired.has(id))
      if (toAdd.length) {
        await admin.from('contact_tag_assignments')
          .upsert(toAdd.map(tag_id => ({ contact_id: existingId, tag_id, source: 'jobber' })),
                  { onConflict: 'contact_id,tag_id', ignoreDuplicates: true })
      }
      if (toRemove.length) {
        await admin.from('contact_tag_assignments')
          .delete().eq('contact_id', existingId).eq('source', 'jobber').in('tag_id', toRemove)
      }
    } catch (e) {
      console.error('[contacts-directory] client sync failed', c.external_id, e)
    }
  }

  return { inserted, enriched }
}

export type DirectoryLeadInput = {
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
}

/**
 * Upsert ONE lead-tracker lead into the unified directory (txt_contacts) with
 * source 'leads'. Match precedence: phone (last 10) → email; else insert.
 *
 * CONSENT GUARD: a lead form is not texting consent, so any row created — or
 * any phone adopted — from this source is set do_not_text = true (mirrors the
 * Jobber feed). Hand-edited rows keep their core fields; we only fill blanks.
 *
 * LIMITATION: txt_contacts.phone is still NOT NULL (the email-only fold-in is
 * deferred — see 2026-06-22_contacts_directory_foundation.sql). So an email-only
 * lead can only ENRICH an existing match; it can't create a new phone-less row.
 * Returns 'inserted' | 'enriched' | 'skipped' for logging. Never throws.
 */
export async function syncLeadToDirectory(
  admin: Admin,
  companyId: string,
  lead: DirectoryLeadInput,
): Promise<'inserted' | 'enriched' | 'skipped'> {
  try {
    const ten = tenDigits(lead.phone)
    const e164 = ten ? '+1' + ten : null
    const email = lead.email?.trim() || null
    if (!ten && !email) return 'skipped' // nothing to match or store on

    // 1) locate the directory row: phone → email
    let existingId: string | null = null
    if (ten) {
      const { data } = await admin.from('txt_contacts')
        .select('id').eq('company_id', companyId).in('phone_digits', [ten, '1' + ten]).limit(1).maybeSingle()
      if (data) existingId = data.id as string
    }
    if (!existingId && email) {
      const { data } = await admin.from('txt_contacts')
        .select('id').eq('company_id', companyId).ilike('email', email).limit(1).maybeSingle()
      if (data) existingId = data.id as string
    }

    if (existingId) {
      const { data: cur } = await admin.from('txt_contacts')
        .select('sources, manually_edited, first_name, last_name, email, phone').eq('id', existingId).single()
      const update: Record<string, unknown> = {
        sources: Array.from(new Set([...((cur?.sources as string[]) ?? []), 'leads'])),
        updated_at: new Date().toISOString(),
      }
      if (!cur?.manually_edited) {
        if (!cur?.first_name && lead.first_name) update.first_name = lead.first_name
        if (!cur?.last_name && lead.last_name) update.last_name = lead.last_name
      }
      // adopt phone if the row has none and it's free → no texting consent
      if (!cur?.phone && e164) {
        const { count } = await admin.from('txt_contacts')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId).in('phone_digits', [ten!, '1' + ten!]).neq('id', existingId)
        if (!count) { update.phone = e164; update.phone_digits = ten; update.do_not_text = true }
      }
      // adopt email if the row has none and it's free
      if (!cur?.email && email) {
        const { count } = await admin.from('txt_contacts')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId).ilike('email', email).neq('id', existingId)
        if (!count) update.email = email
      }
      await admin.from('txt_contacts').update(update).eq('id', existingId)
      return 'enriched'
    }

    // 2) insert — requires a phone (NOT NULL); email-only can't create a row yet.
    if (!e164) return 'skipped'
    const nm = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || email || e164
    const { error } = await admin.from('txt_contacts').insert({
      company_id: companyId, name: nm, first_name: lead.first_name, last_name: lead.last_name,
      phone: e164, phone_digits: ten, email, email_status: 'subscribed',
      do_not_text: true, sources: ['leads'], manually_edited: false,
    })
    if (error) {
      console.error('[contacts-directory] lead insert failed', error.message)
      return 'skipped'
    }
    return 'inserted'
  } catch (e) {
    console.error('[contacts-directory] syncLeadToDirectory failed', e)
    return 'skipped'
  }
}
