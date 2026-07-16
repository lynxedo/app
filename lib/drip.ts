// The unified drip-marketing engine (Drip Marketing PRD §5). Increment 1 = SMS
// speed-to-lead. Two halves, both driven by the /api/drip/process cron:
//
//   1) runDripEnrollmentSweeps  — triggers (new_lead / lead_source) enroll matching
//      `leads` rows into active campaigns (idempotent: one enrollment per
//      (campaign, lead) via a partial unique index). The watermark is captured
//      BEFORE the scan and the unique index is the real guard, so no lead is ever
//      missed or double-enrolled.
//   2) advanceDripEnrollments   — the state machine. For each due enrollment, fire
//      the current step (send SMS via the existing lib/txt-send stack so the text
//      lands in the customer's normal Txt thread and replies route back for the
//      auto-pause), then schedule the next step by its delay.
//
// Auto-pause lives out of band in pauseEnrollmentsForInbound(), called by the Txt
// inbound webhook: the instant the lead replies, their active enrollments flip to
// 'replied' (or 'opted_out' on STOP) and the tick simply skips non-'active' rows.
//
// Model note: a step's `delay` is the wait BEFORE that step fires, applied when we
// SCHEDULE into it. Enrollment sets next_run_at = now, so step 0 is the instant
// first touch; step N's delay is the gap after step N-1. Guards run in order:
// opted-out → quiet-hours (defer) → frequency cap (defer) → send. Modeled directly
// on the proven email automation engine (lib/email-automations.ts).
import { createAdminClient } from '@/lib/supabase/admin'
import { sendDirectTxtToPhone } from '@/lib/txt-send'
import { toE164 } from '@/lib/twilio'
import { fetchAllRows } from '@/lib/email-contacts'
// Email channel (Phase 2) — reuse the proven Email Marketing send stack.
import { renderAndSendEmail } from '@/lib/email-campaigns'
import { resolveSendIdentity } from '@/lib/email-identities'
import { normalizeDesign, renderDesignToHtml } from '@/lib/email-blocks'
import { markdownToHtml } from '@/lib/email-markdown'
// Ringless voicemail (Phase 4) — the BYO-key VoiceDrop provider layer (dark until consent-gated).
import { resolveVoiceDropKey, sendVoiceDropDrop, validateVoiceDropNumber } from '@/lib/voicedrop'
import { getDripAudioAsset } from '@/lib/drip-audio'

type Admin = ReturnType<typeof createAdminClient>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Staging sandbox switch (NEVER set on prod): run the whole state machine but
// don't actually send — every "send" is logged with a TEST marker so a lead
// still enrolls and flows through the monitor with zero real texts. Mirrors the
// AI receptionist's VOICE_TEST_MODE.
const DRIP_TEST_MODE = process.env.DRIP_TEST_MODE === 'true'

type CampaignRow = {
  id: string
  company_id: string
  trigger_type: string
  trigger_config: any
  status: string
  quiet_hours: any
  last_swept_at: string | null
  created_at: string
}

type StepRow = { channel: string; delay: any; content_ref: any }

type QuietHours = { start: number; end: number; tz: string }
type Settings = {
  quiet_hours: QuietHours
  send_as_user_id: string | null
  frequency_cap: number
  default_email_identity_id: string | null
  rvm_enabled: boolean
  rvm_consent_confirmed: boolean
}

const DEFAULT_QUIET: QuietHours = { start: 8, end: 20, tz: 'America/Chicago' }

// ─── 1. Enrollment sweeps ────────────────────────────────────────────────────

export async function runDripEnrollmentSweeps(admin: Admin): Promise<{ enrolled: number }> {
  const { data: campaigns } = await admin
    .from('drip_campaigns')
    .select('id, company_id, trigger_type, trigger_config, status, quiet_hours, last_swept_at, created_at')
    .eq('status', 'active')

  let enrolled = 0
  for (const c of (campaigns ?? []) as CampaignRow[]) {
    // Capture the watermark BEFORE the scan; the partial unique index prevents
    // any double-enroll, so this only ever bounds the scan window.
    const sweepStart = new Date().toISOString()
    if (c.trigger_type === 'new_lead') enrolled += await sweepLeads(admin, c, null)
    else if (c.trigger_type === 'lead_source') {
      const src = typeof c.trigger_config?.lead_source === 'string' ? c.trigger_config.lead_source : null
      if (src) enrolled += await sweepLeads(admin, c, src)
    } else if (c.trigger_type === 'stage_changed') {
      const stage = typeof c.trigger_config?.stage === 'string' ? c.trigger_config.stage : null
      if (stage) enrolled += await sweepStageChanged(admin, c, stage)
    }
    // 'manual' enrolls via the UI, not a sweep.
    await admin.from('drip_campaigns').update({ last_swept_at: sweepStart }).eq('id', c.id)
  }
  return { enrolled }
}

// New `leads` rows (with a phone) created since the last sweep — the watermark is
// seeded at activation, so activating a campaign does NOT blast the back-catalog.
async function sweepLeads(admin: Admin, c: CampaignRow, leadSource: string | null): Promise<number> {
  const cutoff = c.last_swept_at || c.created_at
  const rows = await fetchAllRows<any>(() => {
    let q = admin
      .from('leads')
      .select('id, company_id, phone, first_name, last_name')
      .eq('company_id', c.company_id)
      .not('phone', 'is', null)
      .gt('created_at', cutoff)
    if (leadSource) q = q.eq('lead_source', leadSource)
    return q.order('id', { ascending: true })
  })

  return upsertEnrollments(admin, c.company_id, c.id, rows)
}

// Shared: turn lead rows into enrollment upserts at step 0 (idempotent via the
// (campaign_id, lead_id) unique index — conflicts aren't returned, so data.length
// is the count actually enrolled).
async function upsertEnrollments(
  admin: Admin,
  companyId: string,
  campaignId: string,
  leadRows: Array<{ id: string; phone: string | null }>,
): Promise<number> {
  const enrollRows = leadRows
    .map((r) => {
      const e164 = toE164(r.phone || '')
      if (!e164) return null
      return {
        company_id: companyId,
        campaign_id: campaignId,
        lead_id: r.id,
        phone: e164,
        phone_digits: e164.replace(/\D/g, '').slice(-10),
        current_step_index: 0,
        status: 'active',
        next_run_at: new Date().toISOString(),
      }
    })
    .filter(Boolean) as Record<string, unknown>[]
  if (!enrollRows.length) return 0
  let inserted = 0
  for (const part of chunk(enrollRows, 500)) {
    const { data } = await admin
      .from('drip_enrollments')
      .upsert(part, { onConflict: 'campaign_id,lead_id', ignoreDuplicates: true })
      .select('id')
    inserted += (data ?? []).length
  }
  return inserted
}

// Leads that ENTERED a stage since the last sweep (stage_changed campaigns).
// Casts: stage_changed_at is an additive column applied with the deploy migration.
async function sweepStageChanged(admin: Admin, c: CampaignRow, stageKey: string): Promise<number> {
  const cutoff = c.last_swept_at || c.created_at
  const rows = await fetchAllRows<any>(() =>
    (admin.from('leads') as any)
      .select('id, company_id, phone')
      .eq('company_id', c.company_id)
      .eq('stage', stageKey)
      .not('phone', 'is', null)
      .gt('stage_changed_at', cutoff)
      .order('id', { ascending: true }),
  )
  return upsertEnrollments(admin, c.company_id, c.id, rows)
}

// Inline enroll when a human drags a lead into a stage (so a stage-triggered
// campaign fires immediately, not on the next ≤2-min sweep). Idempotent.
export async function enrollLeadInStageCampaigns(
  admin: Admin,
  opts: { companyId: string; leadId: string; stageKey: string },
): Promise<{ enrolled: number }> {
  const { data: campaigns } = await admin
    .from('drip_campaigns')
    .select('id, trigger_config')
    .eq('company_id', opts.companyId)
    .eq('status', 'active')
    .eq('trigger_type', 'stage_changed')
  const matching = (campaigns ?? []).filter((c: any) => c.trigger_config?.stage === opts.stageKey)
  if (!matching.length) return { enrolled: 0 }
  const { data: lead } = await (admin.from('leads') as any).select('id, phone').eq('id', opts.leadId).maybeSingle()
  if (!lead) return { enrolled: 0 }
  let enrolled = 0
  for (const c of matching) enrolled += await upsertEnrollments(admin, opts.companyId, (c as any).id as string, [lead])
  return { enrolled }
}

// Exit a lead's active/paused enrollments (e.g. they were won or lost) so nurturing stops.
export async function exitEnrollmentsForLead(
  admin: Admin,
  opts: { companyId: string; leadId: string },
): Promise<{ exited: number }> {
  const { data } = await admin
    .from('drip_enrollments')
    .update({ status: 'exited', completed_at: new Date().toISOString() })
    .eq('company_id', opts.companyId)
    .eq('lead_id', opts.leadId)
    .in('status', ['active', 'replied'])
    .select('id')
  return { exited: (data ?? []).length }
}

// ─── 2. Advancement (the state machine) ──────────────────────────────────────

type EnrollmentRow = {
  id: string
  company_id: string
  campaign_id: string
  lead_id: string | null
  contact_id: string | null
  phone: string | null
  phone_digits: string | null
  current_step_index: number
}

export async function advanceDripEnrollments(
  admin: Admin,
  opts: { startedAt: number; maxMs: number; maxCount: number; baseUrl: string },
): Promise<{ processed: number; sent: number }> {
  const campaigns = new Map<string, CampaignRow | null>()
  const steps = new Map<string, StepRow[]>()
  const settings = new Map<string, Settings>()
  // Email-channel per-tick caches (mirror lib/email-automations.ts).
  const identities = new Map<string, Awaited<ReturnType<typeof resolveSendIdentity>>>()
  const suppressed = new Map<string, Set<string>>()
  const emailTemplates = new Map<string, any>()

  let processed = 0
  let sent = 0

  async function getCampaign(id: string): Promise<CampaignRow | null> {
    if (campaigns.has(id)) return campaigns.get(id)!
    const { data } = await admin
      .from('drip_campaigns')
      .select('id, company_id, trigger_type, trigger_config, status, quiet_hours, last_swept_at, created_at')
      .eq('id', id)
      .maybeSingle()
    campaigns.set(id, (data as CampaignRow) ?? null)
    return (data as CampaignRow) ?? null
  }
  async function getSteps(campaignId: string): Promise<StepRow[]> {
    if (steps.has(campaignId)) return steps.get(campaignId)!
    const { data } = await admin
      .from('drip_steps')
      .select('channel, delay, content_ref')
      .eq('campaign_id', campaignId)
      .eq('active', true)
      .order('step_index', { ascending: true })
    const arr = (data ?? []) as StepRow[]
    steps.set(campaignId, arr)
    return arr
  }
  async function getSettings(companyId: string): Promise<Settings> {
    if (settings.has(companyId)) return settings.get(companyId)!
    const { data } = await admin
      .from('drip_settings')
      .select('quiet_hours, send_as_user_id, frequency_cap, default_email_identity_id, rvm_enabled, rvm_consent_confirmed')
      .eq('company_id', companyId)
      .maybeSingle()
    const s: Settings = {
      quiet_hours: normalizeQuiet((data as any)?.quiet_hours),
      send_as_user_id: (data as any)?.send_as_user_id ?? null,
      frequency_cap: typeof (data as any)?.frequency_cap === 'number' ? (data as any).frequency_cap : 6,
      default_email_identity_id: (data as any)?.default_email_identity_id ?? null,
      rvm_enabled: (data as any)?.rvm_enabled === true,
      rvm_consent_confirmed: (data as any)?.rvm_consent_confirmed === true,
    }
    settings.set(companyId, s)
    return s
  }
  async function getIdentity(companyId: string, identityId: string | null) {
    const key = identityId ? `id:${identityId}` : `def:${companyId}`
    if (identities.has(key)) return identities.get(key)!
    const resolved = await resolveSendIdentity(admin, companyId, identityId)
    identities.set(key, resolved)
    return resolved
  }
  async function getSuppressed(companyId: string): Promise<Set<string>> {
    if (suppressed.has(companyId)) return suppressed.get(companyId)!
    const { data } = await admin.from('email_suppressions').select('email').eq('company_id', companyId)
    const set = new Set<string>((data ?? []).map((r: any) => (r.email as string).toLowerCase()))
    suppressed.set(companyId, set)
    return set
  }
  async function getEmailTemplate(id: string): Promise<any> {
    if (emailTemplates.has(id)) return emailTemplates.get(id)
    const { data } = await admin.from('email_templates').select('id, subject, design').eq('id', id).maybeSingle()
    emailTemplates.set(id, (data as any) ?? null)
    return (data as any) ?? null
  }

  while (Date.now() - opts.startedAt <= opts.maxMs && processed < opts.maxCount) {
    const { data: due } = await admin
      .from('drip_enrollments')
      .select('id, company_id, campaign_id, lead_id, contact_id, phone, phone_digits, current_step_index')
      .eq('status', 'active')
      .lte('next_run_at', new Date().toISOString())
      .order('next_run_at', { ascending: true })
      .limit(25)
    if (!due || due.length === 0) break

    for (const e of due as EnrollmentRow[]) {
      if (Date.now() - opts.startedAt > opts.maxMs || processed >= opts.maxCount) break
      processed++

      const campaign = await getCampaign(e.campaign_id)
      if (!campaign || campaign.status !== 'active') {
        // Paused/deleted mid-flight: park it an hour out so we don't reselect it every tick.
        await admin
          .from('drip_enrollments')
          .update({ next_run_at: new Date(Date.now() + 3_600_000).toISOString() })
          .eq('id', e.id)
        continue
      }

      const s = await getSettings(e.company_id)

      const stepList = await getSteps(e.campaign_id)
      const idx = e.current_step_index
      if (idx >= stepList.length) {
        await admin
          .from('drip_enrollments')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', e.id)
        continue
      }
      const step = stepList[idx]
      const person = await resolvePerson(admin, e)

      // ── Guard: quiet hours (all channels; defer, never drop) ──────────────────
      const qh = campaign.quiet_hours ? normalizeQuiet(campaign.quiet_hours) : s.quiet_hours
      const deferUntil = quietHoursDefer(new Date(), qh)
      if (deferUntil) {
        await admin.from('drip_enrollments').update({ next_run_at: deferUntil.toISOString() }).eq('id', e.id)
        continue
      }

      // ── Guard: frequency cap (rolling 24h, per person, across campaigns + channels) ──
      {
        const since = new Date(Date.now() - 86_400_000).toISOString()
        let touches = 0
        if (e.phone) {
          const { count } = await admin
            .from('drip_sends')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', e.company_id).eq('status', 'sent').eq('to_phone', e.phone).gte('sent_at', since)
          touches += count ?? 0
        }
        if (person?.email) {
          const { count } = await (admin.from('drip_sends') as any)
            .select('id', { count: 'exact', head: true })
            .eq('company_id', e.company_id).eq('status', 'sent').eq('to_email', person.email).gte('sent_at', since)
          touches += count ?? 0
        }
        if (touches >= s.frequency_cap) {
          const next = quietHoursDefer(new Date(Date.now() + 3 * 3_600_000), qh) || new Date(Date.now() + 3 * 3_600_000)
          await admin.from('drip_enrollments').update({ next_run_at: next.toISOString() }).eq('id', e.id)
          continue
        }
      }

      // ── Channel dispatch: sms | email | rvm ───────────────────────────────────
      if (step.channel === 'sms') {
        // Sender is required for SMS only — an email/rvm-only campaign isn't wedged by a missing texting user.
        if (!s.send_as_user_id) {
          await admin.from('drip_enrollments').update({ next_run_at: new Date(Date.now() + 3_600_000).toISOString() }).eq('id', e.id)
          continue
        }
        if (person?.do_not_text) {
          await logSend(admin, e, idx, 'sms', 'skipped_opted_out', { body: null, to: e.phone })
          await admin.from('drip_enrollments').update({ status: 'opted_out', paused_reason: 'do_not_text', completed_at: new Date().toISOString() }).eq('id', e.id)
          continue
        }
        const body = renderBody(step.content_ref, person)
        const templateId = typeof step.content_ref?.template_id === 'string' ? step.content_ref.template_id : null
        if (!body && !templateId) {
          await logSend(admin, e, idx, 'sms', 'failed', { body: null, to: e.phone, error: 'empty_step' })
          await advanceStep(admin, e, idx, stepList)
          continue
        }
        // DRIP_TEST_MODE (staging sandbox): fake success, nothing is texted.
        let res: Awaited<ReturnType<typeof sendDirectTxtToPhone>>
        if (DRIP_TEST_MODE) {
          res = { ok: true, twilio_sid: 'TEST' }
        } else {
          res = await sendDirectTxtToPhone({
            admin, companyId: e.company_id, userId: s.send_as_user_id,
            phone: e.phone || '', name: person?.name ?? null, body: body || '', templateId,
          })
        }
        await logSend(admin, e, idx, 'sms', res.ok ? 'sent' : 'failed', {
          body: body || null, to: e.phone, providerRef: res.twilio_sid ?? null, error: res.ok ? null : res.error ?? null,
        })
        if (res.ok) sent++
        // Stamp the resolved contact so reply-pause can match even a contact this send just created.
        const contactId = (res as any).contact_id ?? e.contact_id ?? null
        await advanceStep(admin, e, idx, stepList, contactId)
        await sleep(200)
        continue
      }

      if (step.channel === 'email') {
        const email = person?.email?.trim() || null
        if (!email) {
          await logSend(admin, e, idx, 'email', 'failed', { toEmail: null, error: 'no_email' })
          await advanceStep(admin, e, idx, stepList)
          continue
        }
        // Email opt-out is independent of SMS do_not_text (separate legal regimes).
        const supp = await getSuppressed(e.company_id)
        if (supp.has(email.toLowerCase()) || (person?.email_status && person.email_status !== 'subscribed')) {
          await logSend(admin, e, idx, 'email', 'skipped_suppressed', { toEmail: email })
          await advanceStep(admin, e, idx, stepList)
          continue
        }
        const identityId =
          (typeof step.content_ref?.identity_id === 'string' ? step.content_ref.identity_id : null) ||
          s.default_email_identity_id
        const identity = await getIdentity(e.company_id, identityId)
        if (!identity) {
          // No sending address → HOLD (park an hour), mirroring the email engine.
          await admin.from('drip_enrollments').update({ next_run_at: new Date(Date.now() + 3_600_000).toISOString() }).eq('id', e.id)
          continue
        }
        const tplId = typeof step.content_ref?.template_id === 'string' ? step.content_ref.template_id : null
        let subject = ''
        let bodyHtml = ''
        if (tplId) {
          const tpl = await getEmailTemplate(tplId)
          if (!tpl) {
            await logSend(admin, e, idx, 'email', 'failed', { toEmail: email, error: 'missing_template' })
            await advanceStep(admin, e, idx, stepList)
            continue
          }
          subject = tpl.subject || ''
          bodyHtml = renderDesignToHtml(normalizeDesign(tpl.design), { baseUrl: opts.baseUrl })
        } else {
          subject = typeof step.content_ref?.subject === 'string' ? step.content_ref.subject : ''
          const rawBody = typeof step.content_ref?.body === 'string' ? step.content_ref.body : ''
          if (!subject || !rawBody) {
            await logSend(admin, e, idx, 'email', 'failed', { toEmail: email, subject: subject || null, error: 'empty_step' })
            await advanceStep(admin, e, idx, stepList)
            continue
          }
          bodyHtml = markdownToHtml(rawBody)
        }
        let emailOk = false
        let emailId: string | null = null
        let emailErr: string | null = null
        if (DRIP_TEST_MODE) {
          emailOk = true
          emailId = 'TEST'
        } else {
          const r = await renderAndSendEmail({
            identity, baseUrl: opts.baseUrl, companyId: e.company_id, email,
            firstName: person?.first_name ?? null, lastName: null, subject, bodyHtml, tagValue: 'drip',
          })
          emailOk = r.ok
          emailId = (r as any).id ?? null
          emailErr = r.ok ? null : ((r as any).error ?? null)
        }
        await logSend(admin, e, idx, 'email', emailOk ? 'sent' : 'failed', {
          toEmail: email, subject, providerRef: emailId, error: emailErr,
        })
        if (emailOk) sent++
        await advanceStep(admin, e, idx, stepList)
        await sleep(200)
        continue
      }

      if (step.channel === 'rvm') {
        // RVM is legally a call (FCC 22-85) — OFF until the company confirms consent.
        if (!s.rvm_enabled || !s.rvm_consent_confirmed) {
          await logSend(admin, e, idx, 'rvm', 'skipped_rvm_disabled', { to: e.phone })
          await advanceStep(admin, e, idx, stepList)
          continue
        }
        // Per-lead "no calls" preference (e.g. GLSA "messages only") — honor it.
        if (person?.do_not_call) {
          await logSend(admin, e, idx, 'rvm', 'skipped_no_calls', { to: e.phone })
          await advanceStep(admin, e, idx, stepList)
          continue
        }
        const key = await resolveVoiceDropKey(e.company_id)
        if (!key) {
          await admin.from('drip_enrollments').update({ next_run_at: new Date(Date.now() + 3_600_000).toISOString() }).eq('id', e.id)
          continue
        }
        const assetId = typeof step.content_ref?.audio_asset_id === 'string' ? step.content_ref.audio_asset_id : null
        const asset = assetId ? await getDripAudioAsset(admin, assetId) : null
        if (!asset?.providerVoicemailId) {
          await logSend(admin, e, idx, 'rvm', 'failed', { to: e.phone, error: 'no_audio' })
          await advanceStep(admin, e, idx, stepList)
          continue
        }
        const chk = e.phone ? await validateVoiceDropNumber(e.company_id, e.phone) : { ok: false, reason: 'no_phone' }
        if (!chk.ok) {
          await logSend(admin, e, idx, 'rvm', 'skipped_suppressed', { to: e.phone, error: chk.reason ?? null })
          await advanceStep(admin, e, idx, stepList)
          continue
        }
        const { data: rvmCfg } = await (admin.from('drip_settings') as any).select('rvm_caller_id').eq('company_id', e.company_id).maybeSingle()
        const callerId = asset.callerId || rvmCfg?.rvm_caller_id || ''
        let rvmOk = false
        let rvmRef: string | null = null
        let rvmErr: string | null = null
        if (DRIP_TEST_MODE) {
          rvmOk = true
          rvmRef = 'TEST'
        } else {
          const r = await sendVoiceDropDrop({
            companyId: e.company_id, phone: e.phone || '', voicemailId: asset.providerVoicemailId, callerId,
            metadata: { enrollment_id: e.id, campaign_id: e.campaign_id, step_index: idx },
          })
          rvmOk = r.ok
          rvmRef = r.providerRef ?? null
          rvmErr = r.ok ? null : (r.error ?? null)
        }
        await logSend(admin, e, idx, 'rvm', rvmOk ? 'sent' : 'failed', {
          to: e.phone, providerRef: rvmRef, error: rvmErr, consentBasis: 'warm_inbound',
        })
        if (rvmOk) sent++
        await advanceStep(admin, e, idx, stepList)
        await sleep(200)
        continue
      }

      // Unknown channel — skip forward so a mixed campaign doesn't stall.
      await logSend(admin, e, idx, step.channel, 'skipped_suppressed', { body: null })
      await advanceStep(admin, e, idx, stepList)
    }
  }

  return { processed, sent }
}

// Advance an enrollment past step `idx`: either complete, or schedule the next
// step by its (pre-)delay.
async function advanceStep(
  admin: Admin,
  e: EnrollmentRow,
  idx: number,
  stepList: StepRow[],
  contactId?: string | null,
): Promise<void> {
  const next = idx + 1
  const patch: Record<string, unknown> = { current_step_index: next }
  if (contactId !== undefined && contactId !== null) patch.contact_id = contactId
  if (next >= stepList.length) {
    patch.status = 'completed'
    patch.completed_at = new Date().toISOString()
  } else {
    patch.next_run_at = new Date(Date.now() + waitMs(stepList[next].delay)).toISOString()
  }
  await admin.from('drip_enrollments').update(patch).eq('id', e.id)
}

type Person = {
  id: string | null
  name: string | null
  first_name: string | null
  do_not_text: boolean
  email: string | null
  email_status: string | null
  do_not_call: boolean // per-lead "no calls" preference (gates RVM, which is legally a call)
}

// Resolve the contact for opt-out + personalization: existing directory row by
// phone digits, falling back to the source lead's name (contact may not exist
// until the first send creates it). Casts: do_not_call / leads.email are additive
// columns applied with the deploy migration.
async function resolvePerson(admin: Admin, e: EnrollmentRow): Promise<Person | null> {
  if (e.phone_digits) {
    const { data } = await (admin.from('txt_contacts') as any)
      .select('id, name, first_name, do_not_text, email, email_status, do_not_call')
      .eq('company_id', e.company_id)
      .in('phone_digits', [e.phone_digits, '1' + e.phone_digits])
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()
    if (data) {
      return {
        id: data.id ?? null,
        name: data.name ?? null,
        first_name: data.first_name ?? null,
        do_not_text: data.do_not_text === true,
        email: data.email ?? null,
        email_status: data.email_status ?? null,
        do_not_call: data.do_not_call === true,
      }
    }
  }
  if (e.lead_id) {
    const { data } = await (admin.from('leads') as any)
      .select('first_name, last_name, email')
      .eq('id', e.lead_id)
      .maybeSingle()
    if (data) {
      const name = [data.first_name, data.last_name].filter(Boolean).join(' ').trim() || null
      return {
        id: null,
        name,
        first_name: (data.first_name as string) ?? null,
        do_not_text: false,
        email: (data.email as string) ?? null,
        email_status: null,
        do_not_call: false,
      }
    }
  }
  return null
}

async function logSend(
  admin: Admin,
  e: EnrollmentRow,
  stepIndex: number,
  channel: string,
  status: string,
  extra: {
    body?: string | null
    to?: string | null
    toEmail?: string | null
    subject?: string | null
    providerRef?: string | null
    error?: string | null
    consentBasis?: string | null
  },
): Promise<void> {
  // Cast: to_email/subject/consent_basis are additive columns applied with the deploy migration.
  await admin.from('drip_sends').insert({
    enrollment_id: e.id,
    campaign_id: e.campaign_id,
    company_id: e.company_id,
    step_index: stepIndex,
    channel,
    status,
    provider_ref: extra.providerRef ?? null,
    to_phone: extra.to ?? null,
    to_email: extra.toEmail ?? null,
    subject: extra.subject ?? null,
    body: extra.body ?? null,
    error: extra.error ?? null,
    consent_basis: extra.consentBasis ?? null,
  } as any)
}

// ─── 3. Auto-pause on inbound (called by the Txt inbound webhook) ─────────────

// The instant a lead engages, stop the drip. STOP → opted_out; any other inbound
// → replied (paused) so a human/Amber takes over. Best-effort + idempotent.
export async function pauseEnrollmentsForInbound(
  admin: Admin,
  opts: { companyId: string; contactId?: string | null; phone?: string | null; isOptOut: boolean },
): Promise<{ paused: number; enrollmentIds: string[] }> {
  const digits = opts.phone ? opts.phone.replace(/\D/g, '').slice(-10) : null
  const contactId = opts.contactId && /^[0-9a-f-]{36}$/i.test(opts.contactId) ? opts.contactId : null
  if (!contactId && !digits) return { paused: 0, enrollmentIds: [] }

  const patch: Record<string, unknown> = {
    status: opts.isOptOut ? 'opted_out' : 'replied',
    paused_reason: opts.isOptOut ? 'sms_stop' : 'inbound_reply',
  }
  if (opts.isOptOut) patch.completed_at = new Date().toISOString()

  let q = admin.from('drip_enrollments').update(patch).eq('company_id', opts.companyId).eq('status', 'active')
  // contactId is a validated uuid, digits is stripped to [0-9] — safe to inline.
  if (contactId && digits) q = q.or(`contact_id.eq.${contactId},phone_digits.eq.${digits}`)
  else if (contactId) q = q.eq('contact_id', contactId)
  else q = q.eq('phone_digits', digits as string)

  const { data } = await q.select('id')
  const ids = (data ?? []).map((r: any) => r.id as string)
  return { paused: ids.length, enrollmentIds: ids }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function waitMs(config: any): number {
  const days = num(config?.days)
  const hours = num(config?.hours)
  const minutes = num(config?.minutes)
  let ms = 0
  if (days) ms += days * 86_400_000
  if (hours) ms += hours * 3_600_000
  if (minutes) ms += minutes * 60_000
  return ms > 0 ? ms : 0 // no/invalid delay → fire on the next tick
}

function normalizeQuiet(qh: any): QuietHours {
  const start = num(qh?.start)
  const end = num(qh?.end)
  const tz = typeof qh?.tz === 'string' && qh.tz ? qh.tz : DEFAULT_QUIET.tz
  return {
    start: start != null && start >= 0 && start <= 23 ? start : DEFAULT_QUIET.start,
    end: end != null && end >= 1 && end <= 24 ? end : DEFAULT_QUIET.end,
    tz,
  }
}

function renderBody(contentRef: any, person: Person | null): string | null {
  const raw = typeof contentRef?.body === 'string' ? contentRef.body : null
  if (!raw) return null
  const first = person?.first_name?.trim() || person?.name?.trim()?.split(' ')[0] || ''
  const name = person?.name?.trim() || first || ''
  return raw
    .replace(/\{\{\s*first_name\s*\}\}/gi, first)
    .replace(/\{\{\s*name\s*\}\}/gi, name)
    .replace(/\s{2,}/g, ' ') // tidy up if a token expanded to empty
    .trim()
}

// The tz offset (ms) at `date`: add to a UTC instant to read wall-clock in `tz`.
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
  })
  const map: Record<string, number> = {}
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10)
  const asUTC = Date.UTC(map.year, (map.month || 1) - 1, map.day, (map.hour || 0) % 24, map.minute || 0, map.second || 0)
  return asUTC - date.getTime()
}

// If `now` is inside the quiet-hours window, return the next allowed send time
// (today's or tomorrow's window start, in the configured tz). Null = send now.
function quietHoursDefer(now: Date, qh: QuietHours): Date | null {
  if (qh.start <= 0 && qh.end >= 24) return null // 24h window = no quiet hours
  const offset = tzOffsetMs(now, qh.tz)
  const wall = new Date(now.getTime() + offset) // UTC fields now read as tz wall time
  const hour = wall.getUTCHours()
  if (hour >= qh.start && hour < qh.end) return null // inside allowed window

  const y = wall.getUTCFullYear(), m = wall.getUTCMonth(), d = wall.getUTCDate()
  // Before the window opens today → today at start; after it closes → tomorrow at start.
  const dayOffset = hour < qh.start ? 0 : 1
  const targetWallAsUTC = Date.UTC(y, m, d + dayOffset, qh.start, 0, 0)
  return new Date(targetWallAsUTC - offset)
}
