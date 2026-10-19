// Dispatch day-before reminders (Reference/PRDs/DISPATCH_ROUTING_PRD.md Phase 3).
//
// Ben, Oct 19 2026: every visit gets a reminder — text, email or both — from
// templates picked by LINE ITEM, with "arrival between X and Y" wording for a
// timed visit and different wording for an anytime one. Sent as the company,
// not a person. Built with the master switch OFF: Ben turns it on the same day
// he turns Jobber's own reminders off, so customers never get two.
//
// Reads tomorrow's schedule LIVE from Jobber (visits + assessments, phones with
// smsAllowed, emails) — the mirror has neither contact details nor the anytime
// flag. Sending is idempotent per item + day + channel (dispatch_reminders
// UNIQUE), because staging and prod share one database.

import type { SupabaseClient } from '@supabase/supabase-js'
import { jobberGraphQLAdmin } from '@/lib/jobber'
import { tzOffset } from '@/lib/tz'
import { toE164 } from '@/lib/phone'
import { sendDirectTxtToPhone } from '@/lib/txt-send'
import { sendEmail } from '@/lib/resend'
import { resolveSendIdentity } from '@/lib/email-identities'
import {
  type DispatchSettings, fmtClock, isoToLocal, parseTitleWindow, pickReminderTemplate, renderReminder,
} from '@/lib/dispatch'

type Admin = SupabaseClient<any, any, any>

export type WindowSource = 'promised' | 'jobber' | 'planned' | 'title'

export interface ReminderItem {
  jobberItemId: string
  kind: 'visit' | 'assessment'
  date: string
  clientName: string
  title: string
  address: string
  lineItemNames: string[]
  techIds: string[]
  phone: string | null
  email: string | null
  timed: boolean
  window: { start: number; end: number; source: WindowSource } | null
  template: { id: string; name: string } | null
  sms: { to: string; body: string } | null
  email_msg: { to: string; subject: string; body: string } | null
  skip: string | null
}

const VISITS = `
  query ReminderVisits($cursor: String, $filter: VisitFilterAttributes) {
    visits(first: 40, after: $cursor, filter: $filter) {
      nodes {
        id title startAt endAt allDay isComplete
        arrivalWindow { startAt endAt }
        client { name phones { number smsAllowed primary } emails { address primary } }
        property { address { street1 city province postalCode } }
        lineItems(first: 10) { nodes { name } }
        assignedUsers(first: 5) { nodes { id } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

const ASSESSMENTS = `
  query ReminderAssessments($filter: ScheduledItemsFilterAttributes!) {
    scheduledItems(filter: $filter, first: 50) {
      nodes {
        ... on Assessment {
          id title startAt endAt
          client { name phones { number smsAllowed primary } emails { address primary } }
          property { street city province postalCode }
          assignedUsers(first: 5) { nodes { id } }
        }
      }
    }
  }
`

type Phone = { number: string; smsAllowed: boolean; primary: boolean }
type Email = { address: string; primary: boolean }
type ClientNode = { name: string; phones: Phone[]; emails: Email[] } | null

interface RawItem {
  id: string; kind: 'visit' | 'assessment'; title: string; startAt: string | null; endAt: string | null
  allDay: boolean; isComplete: boolean; arrival: { startAt: string; endAt: string } | null
  client: ClientNode; address: string; lineItemNames: string[]; techIds: string[]
}

function pickPhone(c: ClientNode): string | null {
  const ok = (c?.phones ?? []).filter(p => p.smsAllowed)
  const p = ok.find(x => x.primary) ?? ok[0]
  return p ? toE164(p.number) || null : null
}
function pickEmail(c: ClientNode): string | null {
  const e = (c?.emails ?? []).find(x => x.primary) ?? c?.emails?.[0]
  const a = e?.address?.trim()
  return a && /.+@.+\..+/.test(a) ? a : null
}

/** Every visit + assessment on `date`, live from Jobber. */
export async function fetchDayForReminders(jobberUserId: string, date: string): Promise<RawItem[]> {
  const off = tzOffset(date)
  const start = `${date}T00:00:00${off}`, end = `${date}T23:59:59${off}`
  const out: RawItem[] = []
  let cursor: string | null = null
  for (let page = 0; page < 12; page++) {
    type R = { data?: { visits?: { nodes: Array<Record<string, any>>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }; errors?: Array<{ message: string }> }
    const res: R = await jobberGraphQLAdmin<R>(jobberUserId, VISITS, { cursor, filter: { startAt: { after: start, before: end } } })
    if (res.errors?.length) throw new Error(res.errors[0].message)
    const conn = res.data?.visits
    if (!conn) break
    for (const v of conn.nodes) {
      const a = v.property?.address
      out.push({
        id: v.id, kind: 'visit', title: v.title ?? '', startAt: v.startAt, endAt: v.endAt,
        allDay: v.allDay === true, isComplete: v.isComplete === true,
        arrival: v.arrivalWindow ?? null, client: v.client ?? null,
        address: a ? `${a.street1}, ${a.city}, ${a.province} ${a.postalCode}` : '',
        lineItemNames: (v.lineItems?.nodes ?? []).map((li: { name: string }) => li.name),
        techIds: (v.assignedUsers?.nodes ?? []).map((u: { id: string }) => u.id),
      })
    }
    if (!conn.pageInfo.hasNextPage) break
    cursor = conn.pageInfo.endCursor
  }
  type A = { data?: { scheduledItems?: { nodes: Array<Record<string, any>> } }; errors?: Array<{ message: string }> }
  const ar = await jobberGraphQLAdmin<A>(jobberUserId, ASSESSMENTS, {
    filter: { scheduleItemType: 'ASSESSMENT', occursWithin: { startAt: start, endAt: end } },
  }).catch(() => null)
  if (ar?.errors?.length) console.warn(`[dispatch-reminders] assessments rejected: ${ar.errors[0].message}`)
  for (const a of ar?.data?.scheduledItems?.nodes ?? []) {
    if (!a.id) continue
    const p = a.property
    out.push({
      id: a.id, kind: 'assessment', title: a.title ?? 'Assessment', startAt: a.startAt, endAt: a.endAt,
      allDay: false, isComplete: false, arrival: null, client: a.client ?? null,
      address: p ? `${p.street}, ${p.city}, ${p.province} ${p.postalCode}` : '',
      lineItemNames: [], techIds: (a.assignedUsers?.nodes ?? []).map((u: { id: string }) => u.id),
    })
  }
  return out
}

/** Build tomorrow's reminder list exactly as it would send — the preview and the sender share it. */
export async function buildReminderItems(
  admin: Admin, companyId: string, jobberUserId: string, date: string, settings: DispatchSettings,
): Promise<ReminderItem[]> {
  const raw = await fetchDayForReminders(jobberUserId, date)
  const ids = raw.map(r => r.id)
  const [{ data: company }, locksRes] = await Promise.all([
    admin.from('companies').select('name').eq('id', companyId).maybeSingle(),
    ids.length
      ? admin.from('dispatch_visit_locks').select('jobber_item_id, window_start, window_end').eq('company_id', companyId).in('jobber_item_id', ids)
      : Promise.resolve({ data: [] as Array<{ jobber_item_id: string; window_start: string; window_end: string }> }),
  ])
  const locks = new Map((locksRes.data ?? []).map(l => [l.jobber_item_id as string, l]))
  const companyName = (company?.name as string | undefined) ?? ''
  const rs = settings.reminders
  const dayLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
  const dateLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })

  return raw.filter(r => !r.isComplete).map(r => {
    // Timing: a promise wins; then Jobber's own arrival window; then the planned
    // time; an anytime visit can still carry a time frame in its title (opt-in).
    let window: ReminderItem['window'] = null
    const lock = locks.get(r.id)
    const startLocal = r.startAt ? isoToLocal(r.startAt) : null
    const anytime = r.allDay || !startLocal || startLocal.minutes === 0
    if (lock) {
      window = { start: isoToLocal(lock.window_start).minutes, end: isoToLocal(lock.window_end).minutes, source: 'promised' }
    } else if (!anytime && r.arrival) {
      window = { start: isoToLocal(r.arrival.startAt).minutes, end: isoToLocal(r.arrival.endAt).minutes, source: 'jobber' }
    } else if (!anytime && startLocal) {
      const s = Math.floor(startLocal.minutes / 30) * 30
      window = { start: s, end: s + rs.timed_window_minutes, source: 'planned' }
    } else if (settings.title_windows) {
      const t = parseTitleWindow(r.title, settings)
      if (t) window = { start: t.start, end: t.end, source: 'title' }
    }
    const timed = window !== null
    const tpl = pickReminderTemplate(rs.templates, r.lineItemNames, timed)
    const name = r.client?.name ?? ''
    const vars: Record<string, string> = {
      first_name: name.split(/\s+/)[0] || 'there',
      name,
      company: companyName,
      day: dayLabel,
      date: dateLabel,
      start: window ? fmtClock(window.start) : '',
      end: window ? fmtClock(window.end) : '',
      address: r.address.split(',')[0] ?? '',
      service: r.lineItemNames[0] ?? (r.kind === 'assessment' ? 'assessment' : r.title),
    }
    const phone = pickPhone(r.client)
    const email = pickEmail(r.client)
    const sms = tpl?.sms && phone && tpl.sms_body.trim() ? { to: phone, body: renderReminder(tpl.sms_body, vars).trim() } : null
    const email_msg = tpl?.email && email && tpl.email_body.trim()
      ? { to: email, subject: renderReminder(tpl.email_subject || 'Your visit {day}', vars).trim(), body: renderReminder(tpl.email_body, vars).trim() }
      : null
    let skip: string | null = null
    if (!tpl) skip = `No ${timed ? 'timed' : 'anytime'} template matches`
    else if (!sms && !email_msg) skip = tpl.sms && !phone ? 'No textable phone' + (tpl.email ? ' or email' : '') : tpl.email && !email ? 'No email on file' : 'Template sends nothing'
    return {
      jobberItemId: r.id, kind: r.kind, date, clientName: name, title: r.title, address: r.address,
      lineItemNames: r.lineItemNames, techIds: r.techIds, phone, email, timed, window,
      template: tpl ? { id: tpl.id, name: tpl.name } : null, sms, email_msg, skip,
    }
  })
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c))

export async function sendReminderEmail(
  admin: Admin, companyId: string, settings: DispatchSettings, msg: { to: string; subject: string; body: string },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const ident = await resolveSendIdentity(admin, companyId, settings.reminders.email_identity_id)
  if (!ident) return { ok: false, error: 'No email sender is set up (Admin → Email)' }
  const from = ident.from_name ? `${ident.from_name} <${ident.from_email}>` : ident.from_email
  const html = msg.body.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
    + (ident.physical_address ? `<p style="color:#888;font-size:12px">${esc(ident.physical_address)}</p>` : '')
  const r = await sendEmail({
    from, to: msg.to, subject: msg.subject, text: msg.body + (ident.physical_address ? `\n\n${ident.physical_address}` : ''),
    html, replyTo: ident.reply_to ?? undefined, tags: [{ name: 'kind', value: 'dispatch_reminder' }],
  })
  return r.ok ? { ok: true, id: r.id } : { ok: false, error: r.error }
}

/**
 * Send every unsent reminder in `items`. Each item + channel is claimed in
 * dispatch_reminders first (UNIQUE), so two runs — or staging and prod on the
 * shared DB — can never both send it.
 */
export async function sendReminders(
  admin: Admin, companyId: string, settings: DispatchSettings, items: ReminderItem[],
): Promise<{ sent: number; failed: number; skipped: number }> {
  let sent = 0, failed = 0, skipped = 0
  const owner = settings.reminders.owner_user_id
  for (const it of items) {
    const channels: Array<'sms' | 'email'> = []
    if (it.sms) channels.push('sms')
    if (it.email_msg) channels.push('email')
    if (channels.length === 0) { skipped++; continue }
    for (const ch of channels) {
      const to = ch === 'sms' ? it.sms!.to : it.email_msg!.to
      const { data: claim, error: claimErr } = await admin.from('dispatch_reminders').insert({
        company_id: companyId, jobber_item_id: it.jobberItemId, visit_date: it.date, channel: ch,
        status: 'sending', template_id: it.template?.id ?? null, sent_to: to,
        body: ch === 'sms' ? it.sms!.body : `${it.email_msg!.subject}\n\n${it.email_msg!.body}`,
      }).select('id').maybeSingle()
      if (claimErr || !claim) { skipped++; continue } // already claimed — sent before or in flight
      let res: { ok: boolean; id?: string; error?: string }
      if (ch === 'sms') {
        if (!owner) res = { ok: false, error: 'No Hub user picked to receive replies' }
        else {
          const r = await sendDirectTxtToPhone({
            admin, companyId, userId: owner, phone: it.sms!.to, name: it.clientName, body: it.sms!.body,
            noSignature: true, contactSource: 'dispatch-reminder',
          })
          res = r.ok ? { ok: true, id: r.message_id } : { ok: false, error: r.error }
        }
      } else {
        res = await sendReminderEmail(admin, companyId, settings, it.email_msg!)
      }
      await admin.from('dispatch_reminders').update({
        status: res.ok ? 'sent' : 'failed', provider_id: res.id ?? null, error: res.error ?? null, sent_at: new Date().toISOString(),
      }).eq('id', claim.id)
      if (res.ok) sent++
      else failed++
    }
  }
  return { sent, failed, skipped }
}
