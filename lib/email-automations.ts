// The email automation engine (PRD §5). Two halves, both driven by the
// /api/email/automations/process cron:
//   1) runEnrollmentSweeps  — triggers (new_client / tag_added) enroll matching
//      directory contacts into active automations (idempotent: one enrollment per
//      (automation, contact)).
//   2) advanceDueEnrollments — the state machine. For each due enrollment, walk
//      consecutive send/condition steps inline until a wait (schedules the next
//      run) or the end (completes). Sends reuse renderAndSendEmail so the
//      CAN-SPAM footer + suppression-safe path is identical to campaigns.
//
// Conventions: an automation's steps are ordered by step_index, and
// current_step_index is the 0-based position in that ordered list. A condition
// step's then_step / else_step are positions to jump to. Sends respect the
// suppression ledger (skip, never re-attempt) and are attributed in
// email_automation_sends so the Resend webhook can track + auto-suppress them.
import type { SupabaseClient } from '@supabase/supabase-js'
import { renderAndSendEmail, type EmailSendIdentity } from '@/lib/email-campaigns'
import { normalizeDesign, renderDesignToHtml } from '@/lib/email-blocks'

type Admin = SupabaseClient<any, any, any>

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type AutomationRow = {
  id: string
  company_id: string
  trigger_type: string
  trigger_config: any
  status: string
  last_swept_at: string | null
  created_at: string
}

// ─── 1. Enrollment sweeps ────────────────────────────────────────────────────

export async function runEnrollmentSweeps(admin: Admin): Promise<{ enrolled: number }> {
  const { data: automations } = await admin
    .from('email_automations')
    .select('id, company_id, trigger_type, trigger_config, status, last_swept_at, created_at')
    .eq('status', 'active')

  let enrolled = 0
  for (const a of (automations ?? []) as AutomationRow[]) {
    if (a.trigger_type === 'new_client') enrolled += await sweepNewClient(admin, a)
    else if (a.trigger_type === 'tag_added') enrolled += await sweepTagAdded(admin, a)
    // 'manual' enrolls via the UI, not a sweep.
    await admin.from('email_automations').update({ last_swept_at: new Date().toISOString() }).eq('id', a.id)
  }
  return { enrolled }
}

// New directory contacts (with an email, subscribed) created since the automation
// was last swept — the watermark is seeded to activation time, so activating an
// automation does NOT blast the entire back-catalog.
async function sweepNewClient(admin: Admin, a: AutomationRow): Promise<number> {
  const cutoff = a.last_swept_at || a.created_at
  const { data: contacts } = await admin
    .from('txt_contacts')
    .select('id, email, first_name, last_name')
    .eq('company_id', a.company_id)
    .is('deleted_at', null)
    .eq('email_status', 'subscribed')
    .not('email', 'is', null)
    .gt('created_at', cutoff)
    .limit(500)
  return enrollContacts(admin, a, contacts ?? [])
}

// Any emailable directory contact carrying the trigger tag who isn't enrolled
// yet. (Enroll-if-not-present is idempotent via the unique constraint, so we
// don't need to diff tag-assignment timestamps.)
async function sweepTagAdded(admin: Admin, a: AutomationRow): Promise<number> {
  const tagId = a.trigger_config?.tag_id
  if (!tagId) return 0
  const { data: assigns } = await admin
    .from('contact_tag_assignments')
    .select('contact_id')
    .eq('tag_id', tagId)
    .limit(5000)
  const ids = [...new Set((assigns ?? []).map((x: any) => x.contact_id as string))]
  if (!ids.length) return 0

  let total = 0
  for (const part of chunk(ids, 300)) {
    const { data: contacts } = await admin
      .from('txt_contacts')
      .select('id, email, first_name, last_name')
      .eq('company_id', a.company_id)
      .is('deleted_at', null)
      .eq('email_status', 'subscribed')
      .not('email', 'is', null)
      .in('id', part)
    total += await enrollContacts(admin, a, contacts ?? [])
  }
  return total
}

async function enrollContacts(admin: Admin, a: AutomationRow, contacts: any[]): Promise<number> {
  const rows = contacts
    .filter((c) => c.email)
    .map((c) => ({
      automation_id: a.id,
      company_id: a.company_id,
      contact_id: c.id,
      email: c.email,
      first_name: c.first_name,
      last_name: c.last_name,
      current_step_index: 0,
      next_run_at: new Date().toISOString(),
      status: 'active',
    }))
  if (!rows.length) return 0
  let inserted = 0
  for (const part of chunk(rows, 500)) {
    // (automation_id, contact_id) is a full unique constraint, so onConflict
    // ignoreDuplicates is safe here; conflicting (already-enrolled) rows aren't
    // returned, so data.length = the count actually enrolled this sweep.
    const { data } = await admin
      .from('email_automation_enrollments')
      .upsert(part, { onConflict: 'automation_id,contact_id', ignoreDuplicates: true })
      .select('id')
    inserted += (data ?? []).length
  }
  return inserted
}

// ─── 2. Advancement (the state machine) ──────────────────────────────────────

type StepRow = { step_index: number; type: string; config: any }

const MAX_STEP_HOPS = 25 // guard against a condition loop within one tick

export async function advanceDueEnrollments(
  admin: Admin,
  opts: { startedAt: number; maxMs: number; maxCount: number; baseUrl: string },
): Promise<{ processed: number; sent: number }> {
  const automations = new Map<string, AutomationRow>()
  const steps = new Map<string, StepRow[]>()
  const identities = new Map<string, EmailSendIdentity | null>()
  const suppressed = new Map<string, Set<string>>()
  const templates = new Map<string, { id: string; subject: string; design: any } | null>()

  let processed = 0
  let sent = 0

  async function getAutomation(id: string): Promise<AutomationRow | null> {
    if (automations.has(id)) return automations.get(id)!
    const { data } = await admin
      .from('email_automations')
      .select('id, company_id, trigger_type, trigger_config, status, last_swept_at, created_at')
      .eq('id', id)
      .maybeSingle()
    automations.set(id, (data as AutomationRow) ?? null as any)
    return (data as AutomationRow) ?? null
  }
  async function getSteps(automationId: string): Promise<StepRow[]> {
    if (steps.has(automationId)) return steps.get(automationId)!
    const { data } = await admin
      .from('email_automation_steps')
      .select('step_index, type, config')
      .eq('automation_id', automationId)
      .order('step_index', { ascending: true })
    const arr = (data ?? []) as StepRow[]
    steps.set(automationId, arr)
    return arr
  }
  async function getIdentity(companyId: string): Promise<EmailSendIdentity | null> {
    if (identities.has(companyId)) return identities.get(companyId)!
    const { data } = await admin
      .from('email_settings')
      .select('from_name, from_email, reply_to, physical_address')
      .eq('company_id', companyId)
      .maybeSingle()
    const id = data?.from_email ? (data as EmailSendIdentity) : null
    identities.set(companyId, id)
    return id
  }
  async function getSuppressed(companyId: string): Promise<Set<string>> {
    if (suppressed.has(companyId)) return suppressed.get(companyId)!
    const { data } = await admin.from('email_suppressions').select('email').eq('company_id', companyId)
    const set = new Set((data ?? []).map((s: any) => (s.email as string).toLowerCase()))
    suppressed.set(companyId, set)
    return set
  }
  async function getTemplate(id: string) {
    if (templates.has(id)) return templates.get(id)!
    const { data } = await admin.from('email_templates').select('id, subject, design').eq('id', id).maybeSingle()
    templates.set(id, (data as any) ?? null)
    return (data as any) ?? null
  }
  async function hasTag(contactId: string, tagId: string): Promise<boolean> {
    const { data } = await admin
      .from('contact_tag_assignments')
      .select('contact_id')
      .eq('contact_id', contactId)
      .eq('tag_id', tagId)
      .maybeSingle()
    return !!data
  }

  while (Date.now() - opts.startedAt <= opts.maxMs && processed < opts.maxCount) {
    const { data: due } = await admin
      .from('email_automation_enrollments')
      .select('id, automation_id, company_id, contact_id, email, first_name, last_name, current_step_index')
      .eq('status', 'active')
      .lte('next_run_at', new Date().toISOString())
      .order('next_run_at', { ascending: true })
      .limit(25)
    if (!due || due.length === 0) break

    for (const e of due) {
      if (Date.now() - opts.startedAt > opts.maxMs || processed >= opts.maxCount) break
      processed++

      const automation = await getAutomation(e.automation_id)
      if (!automation || automation.status !== 'active') {
        // Paused/deleted mid-flight: leave the enrollment for when it resumes.
        // Bump next_run_at slightly so we don't reselect it every tick.
        await admin
          .from('email_automation_enrollments')
          .update({ next_run_at: new Date(Date.now() + 3_600_000).toISOString() })
          .eq('id', e.id)
        continue
      }
      const identity = await getIdentity(e.company_id)
      if (!identity) continue // no sending address: HOLD this company's enrollments
      const stepList = await getSteps(e.automation_id)
      const supp = await getSuppressed(e.company_id)

      let idx = e.current_step_index
      let hops = 0
      while (hops++ < MAX_STEP_HOPS) {
        if (idx >= stepList.length) {
          await admin
            .from('email_automation_enrollments')
            .update({ status: 'completed', completed_at: new Date().toISOString(), current_step_index: idx })
            .eq('id', e.id)
          break
        }
        const step = stepList[idx]

        if (step.type === 'wait') {
          await admin
            .from('email_automation_enrollments')
            .update({ current_step_index: idx + 1, next_run_at: new Date(Date.now() + waitMs(step.config)).toISOString() })
            .eq('id', e.id)
          break
        }

        if (step.type === 'condition') {
          const tagId = step.config?.if?.has_tag
          let target: number | null = null
          if (tagId) target = (await hasTag(e.contact_id, tagId)) ? num(step.config?.then_step) : num(step.config?.else_step)
          idx = target != null ? target : idx + 1
          continue
        }

        if (step.type === 'send') {
          const email = (e.email || '').trim()
          const tplId = step.config?.template_id
          if (email && !supp.has(email.toLowerCase()) && tplId) {
            const tpl = await getTemplate(tplId)
            if (tpl) {
              const html = renderDesignToHtml(normalizeDesign(tpl.design), { baseUrl: opts.baseUrl })
              const result = await renderAndSendEmail({
                identity,
                baseUrl: opts.baseUrl,
                companyId: e.company_id,
                email,
                firstName: e.first_name,
                lastName: e.last_name,
                subject: tpl.subject || '',
                bodyHtml: html,
                tagValue: 'automation',
              })
              if (result.ok) {
                sent++
                await admin.from('email_automation_sends').insert({
                  automation_id: e.automation_id,
                  enrollment_id: e.id,
                  step_index: idx,
                  company_id: e.company_id,
                  contact_id: e.contact_id,
                  email,
                  template_id: tplId,
                  provider_message_id: result.id,
                })
              }
              await sleep(200) // gentle spacing between automation sends
            }
          }
          idx++
          // persist progress so a crash mid-chain doesn't resend this step
          await admin.from('email_automation_enrollments').update({ current_step_index: idx }).eq('id', e.id)
          continue
        }

        // Unknown step type — skip it.
        idx++
      }
    }
  }

  return { processed, sent }
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
  return ms > 0 ? ms : 86_400_000 // default 1 day if a wait step has no/!valid duration
}
