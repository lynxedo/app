import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// Shared validation/normalization for a drip campaign's ordered steps + triggers.
// Used by the create + update routes so a saved step array is always well-formed
// for the engine (lib/drip.ts). step_index is assigned by array position.
//
// Channels (the engine dispatches these — see lib/drip.ts advanceDripEnrollments):
//   sms   → content_ref { body } (inline) or { template_id }
//   email → content_ref { subject, body } (body is Markdown) or { subject, template_id },
//           plus optional { identity_id } (a verified email sending identity; the
//           route re-validates ownership with validIdentityId).
//   rvm   → content_ref { audio_asset_id } (ringless voicemail; dark until the
//           company enables + confirms consent in drip_settings).
//
// Model: a step's `delay` is the wait BEFORE it fires. Step 0 is the instant first
// touch (delay forced to {minutes:0} — the engine schedules next_run_at=now on
// enroll); later steps carry the gap after the previous step ({hours:N} | {days:N}).

export type RawDripStep = {
  channel?: string
  delay?: any
  content_ref?: any
  ignore_quiet_hours?: boolean
  resolve?: string
  resolve_user_id?: string | null
  sms_target?: string
}
export type CleanDripStep = {
  step_index: number
  channel: string
  delay: any
  content_ref: any
  ignore_quiet_hours: boolean
  resolve: DripResolveMode
  resolve_user_id: string | null
  sms_target: DripSmsTarget
}
export type DripStepsResult = { ok: true; steps: CleanDripStep[] } | { ok: false; error: string }

// resolve — what happens to the Txt CONVERSATION after a text step sends.
//   archive    = drop it out of the active inbox until the lead replies (the
//                behavior before this setting existed, so it stays the default)
//   unassigned = leave it open in the manager Queue for someone to claim
//   assign     = hand it to one specific person (resolve_user_id)
// Either way an inbound reply reopens the thread — see lib/drip.ts.
export const DRIP_RESOLVE_MODES = ['archive', 'unassigned', 'assign'] as const
export type DripResolveMode = (typeof DRIP_RESOLVE_MODES)[number]

// sms_target — WHERE a text step sends for a Google Local Services (LSA) lead.
//   direct = text the customer's own number (every lead; the original behavior)
//   lsa    = reply inside the lead's Google LSA conversation, so Google sees the
//            response and credits it toward responsiveness
//   both   = do both (Google gets the signal, customer gets the channel they watch)
// 'lsa'/'both' only apply to a lead that HAS a Google lead id; anything else
// falls back to a direct text so a mixed-source campaign never silently skips.
export const DRIP_SMS_TARGETS = ['direct', 'lsa', 'both'] as const
export type DripSmsTarget = (typeof DRIP_SMS_TARGETS)[number]

// Triggers the builder + engine understand. new_lead / lead_source enroll via the
// cron sweep (lib/drip.ts runDripEnrollmentSweeps); manual enrolls from the UI;
// stage_changed enrolls when a Lead Tracker card moves into the configured
// tracker_stages.key (enrollment wired in the tracker path — the builder here just
// captures the trigger + config). Centralized so both routes validate identically.
export const DRIP_TRIGGERS = ['new_lead', 'lead_source', 'manual', 'stage_changed'] as const
export type DripTrigger = (typeof DRIP_TRIGGERS)[number]
export function isDripTrigger(t: unknown): t is DripTrigger {
  return typeof t === 'string' && (DRIP_TRIGGERS as readonly string[]).includes(t)
}

// enroll_window — WHEN a lead may enter a campaign, evaluated against the company's
// Responder business hours. 'always' = today's behavior; 'business_hours' = only
// while the office is open; 'after_hours' = only when closed (nights/weekends).
export const DRIP_ENROLL_WINDOWS = ['always', 'business_hours', 'after_hours'] as const
export type DripEnrollWindow = (typeof DRIP_ENROLL_WINDOWS)[number]
export function normalizeEnrollWindow(v: unknown): DripEnrollWindow {
  return typeof v === 'string' && (DRIP_ENROLL_WINDOWS as readonly string[]).includes(v)
    ? (v as DripEnrollWindow)
    : 'always'
}

const CHANNELS = new Set(['sms', 'email', 'rvm'])
const MAX_STEPS = 20
const MAX_SMS_BODY = 1200 // ~a handful of SMS segments; generous but not unbounded
const MAX_EMAIL_BODY = 20000 // Markdown email body — generous but bounded
const MAX_SUBJECT = 300

export function normalizeDripSteps(raw: unknown): DripStepsResult {
  if (!Array.isArray(raw)) return { ok: false, error: 'Steps must be a list.' }
  if (raw.length > MAX_STEPS) return { ok: false, error: `A campaign can have at most ${MAX_STEPS} steps.` }
  const steps: CleanDripStep[] = []
  raw.forEach((s: RawDripStep, i) => {
    const channel = typeof s?.channel === 'string' && CHANNELS.has(s.channel) ? s.channel : null
    if (!channel) throw new StepError(`Step ${i + 1}: pick a channel (text, email, or voicemail).`)

    // Step 0 = the instant first touch (delay forced to 0). Later steps carry the gap.
    const delay = i === 0 ? { minutes: 0 } : normDelay(s?.delay)
    const content_ref = normalizeContentRef(channel, s?.content_ref, i)
    // ignore_quiet_hours: this step sends even inside the quiet-hours window.
    const ignore_quiet_hours = s?.ignore_quiet_hours === true

    // resolve / sms_target are text-only concepts. Non-text steps keep the
    // defaults so every row has a value and the engine never branches on null.
    let resolve: DripResolveMode = 'archive'
    let resolve_user_id: string | null = null
    let sms_target: DripSmsTarget = 'direct'
    if (channel === 'sms') {
      resolve =
        typeof s?.resolve === 'string' && (DRIP_RESOLVE_MODES as readonly string[]).includes(s.resolve)
          ? (s.resolve as DripResolveMode)
          : 'archive'
      const uid = typeof s?.resolve_user_id === 'string' ? s.resolve_user_id.trim() : ''
      if (resolve === 'assign') {
        // An "assign" with nobody picked would silently strand the thread, so it's
        // a save-time error rather than a quiet downgrade. Ownership is re-checked
        // server-side (sanitizeStepAssignees) before the step is persisted.
        if (!uid) throw new StepError(`Step ${i + 1}: choose who the conversation goes to.`)
        resolve_user_id = uid
      }
      sms_target =
        typeof s?.sms_target === 'string' && (DRIP_SMS_TARGETS as readonly string[]).includes(s.sms_target)
          ? (s.sms_target as DripSmsTarget)
          : 'direct'
      // A Google LSA reply is sent as literal text straight to Google's API, so it
      // can't use a saved Txt template — template rendering (placeholders, then the
      // signature/opt-out stack) happens inside the Twilio send path, which the LSA
      // leg doesn't go through. Rejected at save time rather than silently
      // downgraded to a direct-only text.
      if (sms_target !== 'direct' && !content_ref?.body) {
        throw new StepError(
          `Step ${i + 1}: a Google Local Services reply needs the message typed in here, not a saved template.`,
        )
      }
    }

    steps.push({ step_index: i, channel, delay, content_ref, ignore_quiet_hours, resolve, resolve_user_id, sms_target })
  })
  return { ok: true, steps }
}

// Emit exactly the content_ref shape the engine reads for each channel.
function normalizeContentRef(channel: string, ref: any, i: number): any {
  if (channel === 'sms') {
    const body = typeof ref?.body === 'string' ? ref.body.trim() : ''
    const templateId = typeof ref?.template_id === 'string' ? ref.template_id : ''
    if (!body && !templateId) throw new StepError(`Step ${i + 1}: write the text message.`)
    if (body.length > MAX_SMS_BODY) throw new StepError(`Step ${i + 1}: message is too long (max ${MAX_SMS_BODY} characters).`)
    return body ? { body } : { template_id: templateId }
  }
  if (channel === 'email') {
    const subject = typeof ref?.subject === 'string' ? ref.subject.trim() : ''
    const body = typeof ref?.body === 'string' ? ref.body.trim() : ''
    const templateId = typeof ref?.template_id === 'string' ? ref.template_id : ''
    if (!subject) throw new StepError(`Step ${i + 1}: add an email subject.`)
    if (subject.length > MAX_SUBJECT) throw new StepError(`Step ${i + 1}: subject is too long (max ${MAX_SUBJECT} characters).`)
    if (!body && !templateId) throw new StepError(`Step ${i + 1}: write the email message.`)
    if (body.length > MAX_EMAIL_BODY) throw new StepError(`Step ${i + 1}: email is too long (max ${MAX_EMAIL_BODY} characters).`)
    const out: any = templateId ? { subject, template_id: templateId } : { subject, body }
    // Optional per-step sending identity — shape-checked here; the create/update
    // route re-validates ownership with validIdentityId (nulls it out if it isn't
    // this company's identity) before persisting.
    if (typeof ref?.identity_id === 'string' && ref.identity_id.trim()) out.identity_id = ref.identity_id.trim()
    return out
  }
  if (channel === 'rvm') {
    const assetId = typeof ref?.audio_asset_id === 'string' ? ref.audio_asset_id.trim() : ''
    if (!assetId) throw new StepError(`Step ${i + 1}: choose the voicemail recording.`)
    return { audio_asset_id: assetId }
  }
  throw new StepError(`Step ${i + 1}: unsupported channel.`)
}

// Re-validate each step's resolve target server-side: keep resolve='assign' only
// when the chosen person is a real, current user in THIS company. A stale,
// cross-company, locked or deactivated id downgrades to 'unassigned' (the manager
// Queue) so the thread always lands somewhere a human will see it — never on a
// stranger, never on someone who's been offboarded, never nowhere.
//
// Checked against user_profiles rather than hub_users on purpose: bot users
// (Amber) have no user_profiles row, so this also rules out assigning a customer
// conversation to a bot. Mutates in place. Mirrors sanitizeStepIdentities in the
// campaign routes.
export async function sanitizeStepAssignees(
  admin: Admin,
  companyId: string,
  steps: CleanDripStep[],
): Promise<void> {
  for (const step of steps) {
    if (step.resolve !== 'assign' || !step.resolve_user_id) continue
    const { data } = await admin
      .from('user_profiles')
      .select('id')
      .eq('id', step.resolve_user_id)
      .eq('company_id', companyId)
      .is('locked_at', null)
      .is('deactivated_at', null)
      .maybeSingle()
    if (!data) {
      step.resolve = 'unassigned'
      step.resolve_user_id = null
    }
  }
}

/** Wrap normalizeDripSteps so callers get a result object instead of a throw. */
export function safeNormalizeDripSteps(raw: unknown): DripStepsResult {
  try {
    return normalizeDripSteps(raw)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid steps.' }
  }
}

class StepError extends Error {}

function normDelay(d: any): { days?: number; hours?: number; minutes?: number } {
  const days = Number(d?.days)
  const hours = Number(d?.hours)
  const minutes = Number(d?.minutes)
  const cfg: { days?: number; hours?: number; minutes?: number } = {}
  if (days > 0) cfg.days = Math.round(days)
  if (hours > 0) cfg.hours = Math.round(hours)
  if (minutes > 0) cfg.minutes = Math.round(minutes)
  // A follow-up with no/invalid delay defaults to +1 day (never back-to-back by accident).
  if (!cfg.days && !cfg.hours && !cfg.minutes) cfg.days = 1
  return cfg
}
