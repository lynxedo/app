// Amber 90% — Phase 1 session 3: the first text a new lead gets.
//
// Ben (Oct 15 2026): "instant texts all hours — build the personal reply. but of
// course I need this all to be things I can turn on or off depending on the need."
//
// Two lead sources arrive by themselves with nobody having talked to the person
// yet: Angi (webhook) and Google Local Services message leads (the 5-minute
// poller). For each, Admin → AI → Amber's account → New leads sets:
//   • mode — Off · Canned (the fixed text Angi leads have had since July) ·
//            Amber writes it (from what they asked for; lib/amber-text
//            composeAmberLeadFirstText). If her text can't be written — or it
//            carries a link, a phone number, or a dollar amount that isn't in her
//            own instructions — the canned one goes instead, so a lead is never
//            left silent because of the AI.
//   • when — Any hour · After hours only · Office hours only (dialer business hours).
// plus one master switch for the whole feature.
//
// The defaults are TODAY'S behaviour (lesson: a new setting starts as today):
// Angi gets the canned text at any hour; Google is left to the Drip campaign
// "GLSA After Hours". Once Google is on here, Drip skips every Google lead Amber
// claimed (lib/drip amberHasLead), so nobody gets two first texts — and a lead she
// skipped (outside her hours) is still Drip's to cover.
//
// Flow: the ingest route calls claimLeadText() INLINE right after the lead row is
// written (so the claim exists before Drip's next sweep can see the lead), then
// sendLeadFirstText() in after(). Every lead gets a row in amber_lead_texts:
// what was sent, by which path, whether Google's own thread got it, and the cost.
//
// When Amber wrote the text and "Reply to texts" is on, the thread is marked as
// hers (markLeadThreadAsAmbers), so the lead's reply comes back to her with the
// normal typing grace instead of waiting out the office head start.

import { createAdminClient } from '@/lib/supabase/admin'
import { isWithinBusinessHours, type BusinessHoursSchedule } from '@/lib/twilio-voice'
import { buildCannedLeadTextBody, leadThreadText, type AngiAutoTextInput, type LeadSource } from '@/lib/angi-auto-text'
import { composeAmberLeadFirstText, markLeadThreadAsAmbers } from '@/lib/amber-text'
import { estimateCost } from '@/lib/amber-run'
import { fetchLsaLeadMessage, sendLsaLeadReply } from '@/lib/google-ads'
import { fanoutGuardianNotification } from '@/lib/guardian-post'
import { DEFAULT_RECEPTIONIST_NAME } from '@/lib/voice-receptionist'

type Admin = ReturnType<typeof createAdminClient>

export type LeadTextMode = 'off' | 'canned' | 'amber'
export type LeadTextWhen = 'any' | 'after_hours' | 'office_hours'
export type LeadSourceSetting = { mode: LeadTextMode; when: LeadTextWhen }
export type LeadTextSettings = { enabled: boolean; sources: Record<LeadSource, LeadSourceSetting> }

export const LEAD_SOURCES: LeadSource[] = ['angi', 'google']
export const LEAD_TEXT_MODES: LeadTextMode[] = ['off', 'canned', 'amber']
export const LEAD_TEXT_WHENS: LeadTextWhen[] = ['any', 'after_hours', 'office_hours']

/** Today's behaviour, used until an admin saves something. */
export const DEFAULT_LEAD_TEXT: LeadTextSettings = {
  enabled: true,
  sources: {
    angi: { mode: 'canned', when: 'any' },
    google: { mode: 'off', when: 'any' },
  },
}

const SOURCE_LABEL: Record<LeadSource, string> = { angi: 'Angi', google: 'Google' }

export function normalizeLeadTextSettings(raw: unknown): LeadTextSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { enabled?: unknown; sources?: Record<string, unknown> }
  const sources = {} as Record<LeadSource, LeadSourceSetting>
  for (const src of LEAD_SOURCES) {
    const d = DEFAULT_LEAD_TEXT.sources[src]
    const s = (r.sources?.[src] && typeof r.sources[src] === 'object' ? r.sources[src] : {}) as { mode?: unknown; when?: unknown }
    sources[src] = {
      mode: LEAD_TEXT_MODES.includes(s.mode as LeadTextMode) ? (s.mode as LeadTextMode) : d.mode,
      when: LEAD_TEXT_WHENS.includes(s.when as LeadTextWhen) ? (s.when as LeadTextWhen) : d.when,
    }
  }
  return { enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_LEAD_TEXT.enabled, sources }
}

export async function getLeadTextSettings(admin: Admin, companyId: string): Promise<LeadTextSettings> {
  const { data } = await admin.from('hub_assistant_settings').select('amber_lead_text').eq('company_id', companyId).maybeSingle()
  return normalizeLeadTextSettings((data as { amber_lead_text?: unknown } | null)?.amber_lead_text ?? null)
}

async function officeOpenNow(admin: Admin, companyId: string): Promise<boolean> {
  try {
    const { data } = await admin.from('dialer_settings').select('business_hours').eq('company_id', companyId).maybeSingle()
    return isWithinBusinessHours((data as { business_hours?: BusinessHoursSchedule | null } | null)?.business_hours ?? null)
  } catch {
    return false
  }
}

function whenAllows(when: LeadTextWhen, open: boolean): boolean {
  if (when === 'after_hours') return !open
  if (when === 'office_hours') return open
  return true
}

export type LeadTextClaim = {
  rowId: string | null
  source: LeadSource
  /** What will happen: a text in this mode, or nothing (`skip` says why). */
  mode: LeadTextMode
  skip: string | null
}

/**
 * Decide what this lead gets and record it BEFORE anything is sent. Call inline
 * right after the lead row is written. Never throws; a failure to record returns
 * a claim that still lets the caller fall back to today's behaviour.
 */
export async function claimLeadText(admin: Admin, companyId: string, leadId: string, source: LeadSource): Promise<LeadTextClaim> {
  let settings = DEFAULT_LEAD_TEXT
  try {
    settings = await getLeadTextSettings(admin, companyId)
  } catch (err) {
    console.warn('[amber-lead-text] settings read failed — using defaults', err)
  }
  const s = settings.sources[source]
  let skip: string | null = null
  if (!settings.enabled) skip = 'switched_off'
  else if (s.mode === 'off') skip = 'source_off'
  else if (s.when !== 'any' && !whenAllows(s.when, await officeOpenNow(admin, companyId))) {
    skip = s.when === 'after_hours' ? 'office_open' : 'office_closed'
  }
  const mode: LeadTextMode = skip ? 'off' : s.mode
  try {
    const { data, error } = await admin
      .from('amber_lead_texts')
      .insert({ company_id: companyId, lead_id: leadId, source, mode: skip ? s.mode : mode, status: skip ? 'skipped' : 'pending', reason: skip })
      .select('id')
      .single()
    if (error) {
      // 23505 = this lead already has a row (a retried webhook) — never text twice.
      if ((error as { code?: string }).code === '23505') return { rowId: null, source, mode: 'off', skip: 'already_handled' }
      console.warn('[amber-lead-text] claim insert failed', error.message)
      return { rowId: null, source, mode, skip }
    }
    return { rowId: (data as { id: string }).id, source, mode, skip }
  } catch (err) {
    console.warn('[amber-lead-text] claim failed', err)
    return { rowId: null, source, mode, skip }
  }
}

export type NewLeadForText = AngiAutoTextInput & {
  /** Google's bare numeric lead id (Google leads only) — for the in-Google reply. */
  googleLeadId?: string | null
}

/**
 * Send (or not) the first text per the claim. Best-effort; never throws. Run in
 * after() so the ingest response never waits on the AI or Twilio.
 */
export async function sendLeadFirstText(admin: Admin, companyId: string, claim: LeadTextClaim, lead: NewLeadForText): Promise<void> {
  const update = async (patch: Record<string, unknown>) => {
    if (!claim.rowId) return
    await admin.from('amber_lead_texts').update(patch).eq('id', claim.rowId)
  }
  try {
    if (claim.skip === 'already_handled') return
    if (claim.mode === 'off') {
      // Angi has always put a thread + the write-up in the Txt Queue even when no
      // text goes out of hours; keep that. Google never had a Txt thread before
      // this feature, so a skipped Google lead stays exactly as it was.
      if (claim.source === 'angi') await leadThreadText(admin, companyId, 'angi', lead, null)
      return
    }

    const persona = await personaName(admin, companyId)
    const companyName = await companyDisplayName(admin, companyId)
    const canned = buildCannedLeadTextBody(claim.source, lead.firstName, lead.service, persona, companyName)

    let body = canned
    let fellBack = false
    let usage: { model: string; input: number; output: number; cacheRead: number; cacheWrite: number } | null = null
    if (claim.mode === 'amber') {
      const googleMessage = claim.source === 'google' && lead.googleLeadId ? await fetchLsaLeadMessage(admin, companyId, lead.googleLeadId) : null
      const composed = await composeAmberLeadFirstText(admin, {
        companyId,
        sourceLabel: SOURCE_LABEL[claim.source],
        firstName: lead.firstName,
        service: lead.service,
        request: [googleMessage, lead.note].filter(Boolean).join('\n\n'),
      })
      if (composed) {
        body = composed.text
        usage = { model: composed.model, input: composed.inputTokens, output: composed.outputTokens, cacheRead: composed.cacheReadTokens, cacheWrite: composed.cacheWriteTokens }
      } else {
        fellBack = true
      }
    }

    // Google: the same words inside the lead's own Google thread first — that's
    // the reply Google can see (its responsiveness ranking), then the text.
    let googleSent = false
    if (claim.source === 'google' && lead.googleLeadId) {
      const r = await sendLsaLeadReply(admin, companyId, lead.googleLeadId, body)
      googleSent = r.ok
      if (!r.ok) console.warn('[amber-lead-text] Google thread reply failed', { leadId: lead.googleLeadId, error: r.error })
    }

    const res = await leadThreadText(admin, companyId, claim.source, lead, body)
    const smsSent = res.ok
    if (smsSent && claim.mode === 'amber' && !fellBack && res.conversation_id && !res.kept_owner) {
      await markLeadThreadAsAmbers(admin, companyId, res.conversation_id)
    }

    const reached = smsSent || googleSent
    await update({
      status: reached ? 'sent' : 'failed',
      reason: reached ? (fellBack ? 'amber_text_unusable_sent_canned' : null) : res.skipped || res.error || 'not_sent',
      body,
      fell_back: fellBack,
      sms_sent: smsSent,
      google_sent: googleSent,
      conversation_id: res.conversation_id ?? null,
      model: usage?.model ?? null,
      input_tokens: usage?.input ?? 0,
      output_tokens: usage?.output ?? 0,
      est_cost_usd: usage ? estimateCost(usage.model, { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite }) : null,
      sent_at: reached ? new Date().toISOString() : null,
    })
    if (!reached) console.warn('[amber-lead-text] first text not delivered', { source: claim.source, result: res })
  } catch (err) {
    console.warn('[amber-lead-text] sendLeadFirstText failed', err)
    await update({ status: 'failed', reason: err instanceof Error ? err.message.slice(0, 200) : 'error' }).catch(() => {})
  }
}

async function personaName(admin: Admin, companyId: string): Promise<string> {
  const { data } = await admin.from('voice_receptionist_settings').select('receptionist_name').eq('company_id', companyId).maybeSingle()
  return ((data as { receptionist_name?: string | null } | null)?.receptionist_name || '').trim() || DEFAULT_RECEPTIONIST_NAME
}

async function companyDisplayName(admin: Admin, companyId: string): Promise<string> {
  const { data } = await admin.from('companies').select('name').eq('id', companyId).maybeSingle()
  return ((data as { name?: string | null } | null)?.name || '').trim() || 'our team'
}

// ─── "Send me a test" (Admin → AI → Amber's account) ─────────────────────────
//
// Writes the first text the most recent real lead from this source would get
// with the current setting, and DMs it to the admin who pressed the button.
// Nothing reaches a customer. Logged as a 'test' row (no lead_id) so its cost
// shows in the list.

export async function runLeadTextTest(
  admin: Admin,
  companyId: string,
  opts: { source: LeadSource; recipientId: string },
): Promise<{ ok: true; text: string; costUsd: number | null; sample: string; fellBack: boolean } | { ok: false; error: string }> {
  const settings = await getLeadTextSettings(admin, companyId)
  const mode = settings.sources[opts.source].mode
  const sourceNames = opts.source === 'angi' ? ['Angi Lead', 'Angi Leads'] : ['Google (GBP / LSA)']
  const { data: leadRows } = await admin
    .from('leads')
    .select('id, first_name, service, external_lead_id, created_at')
    .eq('company_id', companyId)
    .in('lead_source', sourceNames)
    .not('external_lead_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
  const sample = ((leadRows as Array<{ id: string; first_name: string | null; service: string | null; external_lead_id: string | null }> | null) ?? [])[0]
  let note = ''
  if (sample) {
    const { data: n } = await admin.from('lead_notes').select('note').eq('lead_id', sample.id).order('created_at', { ascending: true }).limit(1)
    note = ((n as { note: string | null }[] | null) ?? [])[0]?.note || ''
  }
  // A real lead with no name gets "Hi," — so does its test. The made-up name is
  // only for a company with no lead from this source on file at all.
  const firstName = sample ? sample.first_name?.trim() || null : 'Sam'
  const service = sample?.service ?? null
  const persona = await personaName(admin, companyId)
  const companyName = await companyDisplayName(admin, companyId)
  const canned = buildCannedLeadTextBody(opts.source, firstName, service, persona, companyName)

  let text = canned
  let fellBack = false
  let costUsd: number | null = null
  let model: string | null = null
  let inputTokens = 0
  let outputTokens = 0
  if (mode !== 'canned') {
    const googleId = opts.source === 'google' && sample?.external_lead_id?.startsWith('glsa_') ? sample.external_lead_id.slice(5) : null
    const googleMessage = googleId ? await fetchLsaLeadMessage(admin, companyId, googleId) : null
    const composed = await composeAmberLeadFirstText(admin, {
      companyId,
      sourceLabel: SOURCE_LABEL[opts.source],
      firstName,
      service,
      request: [googleMessage, note].filter(Boolean).join('\n\n'),
    })
    if (composed) {
      text = composed.text
      model = composed.model
      inputTokens = composed.inputTokens
      outputTokens = composed.outputTokens
      costUsd = estimateCost(composed.model, { input: composed.inputTokens, output: composed.outputTokens, cacheRead: composed.cacheReadTokens, cacheWrite: composed.cacheWriteTokens })
    } else {
      fellBack = true
    }
  }

  const sampleLabel = sample
    ? firstName
      ? `${firstName}'s ${SOURCE_LABEL[opts.source]} lead`
      : `the latest ${SOURCE_LABEL[opts.source]} lead (no name given)`
    : `a made-up ${SOURCE_LABEL[opts.source]} lead (none on file yet)`
  const howLabel = mode === 'canned' ? 'the canned text' : fellBack ? "the canned text (I couldn't write mine, so this is what would go instead)" : 'the text I would write'
  const dm =
    `🧪 Test — nothing was sent to a customer.\n\nFor ${sampleLabel}, here is ${howLabel}:\n\n"${text}"` +
    (costUsd !== null ? `\n\nCost to write it: about $${costUsd.toFixed(3)}.` : '')
  await fanoutGuardianNotification({ companyId, userIds: [opts.recipientId], roomIds: [], body: dm, admin })

  await admin.from('amber_lead_texts').insert({
    company_id: companyId,
    lead_id: null,
    source: opts.source,
    mode: mode === 'off' ? 'amber' : mode,
    status: 'test',
    reason: sample ? `sample lead ${sample.id}` : 'no sample lead',
    body: text,
    fell_back: fellBack,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    est_cost_usd: costUsd,
  })

  return { ok: true, text, costUsd, sample: sampleLabel, fellBack }
}
