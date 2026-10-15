// Gary's scorecard — session 4 (Oct 15 2026). What Gary did and what came of it,
// for the last 30 days and all time, straight from gary_queue + the Jobber mirror.
//
// "Became a customer" = someone Gary contacted who then got a NEW Jobber job in
// the department of what he wrote about (IR for irrigation/drainage, WF for lawn
// health/aeration, MO for mosquito), created after his first message went out.
// It credits Gary for anyone who came back after he wrote — some would have come
// back anyway — so it's an upper bound, said so on the card.

import type { SupabaseClient } from '@supabase/supabase-js'
import { GARY_SERVICE_DEPT, type GaryService } from '@/lib/gary'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>

type QueueRow = {
  id: string
  person_key: string
  channel: 'email' | 'text'
  touch: number
  status: string
  edited: boolean
  est_cost_usd: number | string | null
  to_name: string | null
  to_email: string | null
  to_phone: string | null
  contact_id: string | null
  context: { services?: GaryService[] } | null
  sent_at: string | null
  created_at: string
  reply_kind: string | null
}

export type GaryScoreWindow = {
  written: number
  costUsd: number
  sent: { email: number; text: number; byTouch: [number, number, number] }
  contacted: number
  replied: number
  declined: number
  optedOut: number
  approvedAsWritten: number
  edited: number
  turnedDown: number
  notSent: number
  expired: number
  becameCustomers: number
  jobs: number
  jobValue: number
}

export type GaryScorecard = {
  last30: GaryScoreWindow
  allTime: GaryScoreWindow
  wins: { name: string; jobs: number; value: number; firstSentAt: string }[]
}

function emptyWindow(): GaryScoreWindow {
  return {
    written: 0,
    costUsd: 0,
    sent: { email: 0, text: 0, byTouch: [0, 0, 0] },
    contacted: 0,
    replied: 0,
    declined: 0,
    optedOut: 0,
    approvedAsWritten: 0,
    edited: 0,
    turnedDown: 0,
    notSent: 0,
    expired: 0,
    becameCustomers: 0,
    jobs: 0,
    jobValue: 0,
  }
}

const p10 = (v: string | null | undefined) => {
  const d = (v || '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}

async function readAll<T>(build: () => any): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) return out
  }
}

export async function buildGaryScorecard(admin: Admin, companyId: string): Promise<GaryScorecard> {
  const rows = await readAll<QueueRow>(() =>
    admin
      .from('gary_queue')
      .select('id, person_key, channel, touch, status, edited, est_cost_usd, to_name, to_email, to_phone, contact_id, context, sent_at, created_at, reply_kind')
      .eq('company_id', companyId)
      .order('id'),
  )
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const last30 = emptyWindow()
  const allTime = emptyWindow()

  // Per person: their first sent message (that's "contacted"), and how it ended.
  type Person = { firstSentAt: string; name: string; email: string | null; phone: string | null; contactId: string | null; services: GaryService[]; reply: string | null }
  const people = new Map<string, Person>()

  for (const r of rows) {
    const windows = r.created_at >= since30 ? [allTime, last30] : [allTime]
    for (const w of windows) {
      w.written++
      w.costUsd += Number(r.est_cost_usd) || 0
      if (r.status === 'rejected') w.turnedDown++
      if (r.status === 'withdrawn' || r.status === 'failed') w.notSent++
      if (r.status === 'expired') w.expired++
    }
    if (r.status === 'sent' && r.sent_at) {
      const sentWindows = r.sent_at >= since30 ? [allTime, last30] : [allTime]
      for (const w of sentWindows) {
        w.sent[r.channel]++
        w.sent.byTouch[Math.min(3, Math.max(1, r.touch)) - 1]++
        if (r.edited) w.edited++
        else w.approvedAsWritten++
      }
      const p = people.get(r.person_key)
      if (!p || r.sent_at < p.firstSentAt) {
        people.set(r.person_key, {
          firstSentAt: r.sent_at,
          name: r.to_name || r.to_email || r.to_phone || 'Someone',
          email: (r.to_email || p?.email || null)?.toLowerCase() ?? null,
          phone: p10(r.to_phone) ?? p?.phone ?? null,
          contactId: r.contact_id ?? p?.contactId ?? null,
          services: (r.context?.services ?? p?.services ?? []) as GaryService[],
          reply: r.reply_kind ?? p?.reply ?? null,
        })
      } else {
        if (!p.reply && r.reply_kind) p.reply = r.reply_kind
        if (!p.email && r.to_email) p.email = r.to_email.toLowerCase()
        if (!p.phone && r.to_phone) p.phone = p10(r.to_phone)
        if (!p.contactId && r.contact_id) p.contactId = r.contact_id
      }
    }
  }

  for (const p of people.values()) {
    for (const w of p.firstSentAt >= since30 ? [allTime, last30] : [allTime]) {
      w.contacted++
      if (p.reply === 'reply') w.replied++
      if (p.reply === 'declined') w.declined++
      if (p.reply === 'opted_out') w.optedOut++
    }
  }

  // Who became a customer for what Gary wrote about.
  const wins: GaryScorecard['wins'] = []
  if (people.size) {
    const [clients, contacts, jobs] = await Promise.all([
      readAll<{ external_id: string; email: string | null; phone: string | null; phone_digits_all: string[] | null }>(() =>
        admin.from('clients').select('external_id, email, phone, phone_digits_all').eq('company_id', companyId).is('deleted_at', null).order('id'),
      ),
      readAll<{ id: string; jobber_client_id: string | null }>(() =>
        admin.from('txt_contacts').select('id, jobber_client_id').eq('company_id', companyId).not('jobber_client_id', 'is', null).order('id'),
      ),
      readAll<{ client_external_id: string | null; dept_prefix: string | null; total: number | string | null; external_created_at: string | null }>(() =>
        admin.from('jobs').select('client_external_id, dept_prefix, total, external_created_at').eq('company_id', companyId).is('deleted_at', null).order('id'),
      ),
    ])
    const byEmail = new Map<string, string[]>()
    const byPhone = new Map<string, string[]>()
    for (const c of clients) {
      const e = (c.email || '').trim().toLowerCase()
      if (e) byEmail.set(e, [...(byEmail.get(e) ?? []), c.external_id])
      for (const ph of new Set([p10(c.phone), ...(c.phone_digits_all ?? []).map(p10)].filter(Boolean) as string[])) {
        byPhone.set(ph, [...(byPhone.get(ph) ?? []), c.external_id])
      }
    }
    const clientOfContact = new Map(contacts.map((c) => [c.id, c.jobber_client_id as string]))
    const jobsByClient = new Map<string, typeof jobs>()
    for (const j of jobs) if (j.client_external_id) jobsByClient.set(j.client_external_id, [...(jobsByClient.get(j.client_external_id) ?? []), j])

    for (const p of people.values()) {
      const ext = new Set<string>([
        ...(p.email ? byEmail.get(p.email) ?? [] : []),
        ...(p.phone ? byPhone.get(p.phone) ?? [] : []),
        ...(p.contactId && clientOfContact.get(p.contactId) ? [clientOfContact.get(p.contactId) as string] : []),
      ])
      const depts = new Set(p.services.map((s) => GARY_SERVICE_DEPT[s]))
      const newJobs = [...ext]
        .flatMap((x) => jobsByClient.get(x) ?? [])
        .filter((j) => j.dept_prefix && depts.has(j.dept_prefix) && (j.external_created_at || '') > p.firstSentAt)
      if (!newJobs.length) continue
      const value = newJobs.reduce((sum, j) => sum + (Number(j.total) || 0), 0)
      wins.push({ name: p.name, jobs: newJobs.length, value, firstSentAt: p.firstSentAt })
      for (const w of p.firstSentAt >= since30 ? [allTime, last30] : [allTime]) {
        w.becameCustomers++
        w.jobs += newJobs.length
        w.jobValue += value
      }
    }
  }

  for (const w of [last30, allTime]) w.costUsd = Math.round(w.costUsd * 100) / 100
  wins.sort((a, b) => b.firstSentAt.localeCompare(a.firstSentAt))
  return { last30, allTime, wins: wins.slice(0, 20) }
}
