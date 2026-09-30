// AI Voice Receptionist — live, on-demand customer lookup.
//
// Called by the voice WS service (~/lynxedo-voice) MID-CALL, only when the caller
// asks about their account (e.g. "when are you coming?", "what service is
// scheduled?"). It is NOT called at call setup — the greeting stays fast and
// nothing is fetched before "hello". The assistant says "let me pull that up,
// one moment", the service calls this endpoint, and the returned `answer` is fed
// back to the assistant to speak.
//
// Data comes LIVE from Jobber (not the mirrored `visits` table), so the caller
// always hears current schedule info. Read-only: this never writes to Jobber.
//
// Two things this used to get wrong (Sep 30 2026):
//   • It asked Jobber only for UPCOMING visits. Jobber files a same-day visit as
//     TODAY (or LATE once its time has passed), so a customer calling on the day
//     of their visit — Mary Evans, "no one has showed up" — was told the account
//     couldn't be pulled up. It now asks for everything from today onward and
//     says plainly when today's visit is already marked complete.
//   • It could only find a caller by the number they were calling from. A caller
//     the number doesn't match can now be found by the NAME on the account plus
//     the service address (both asked for on the call), via the local mirror.
//
// Auth: same Bearer VOICE_SERVICE_SECRET as /api/voice/brain + /api/voice/wrapup.

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { findClientByNameAndAddress, lookupByPhone } from '@/lib/dialer-lookup'
import { jobberGraphQLAdmin, companyJobberUserId } from '@/lib/jobber'
import { getEffectiveVoiceReceptionistSettings } from '@/lib/voice-receptionist-settings'
import { decodeServiceFromTitle, decodeServiceFromLineItems } from '@/lib/voice-receptionist'
import { addDaysYmd } from '@/lib/voice-scheduling'

export const dynamic = 'force-dynamic'

const HEROES_COMPANY_ID = process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

function bearerAuthorized(request: Request): boolean {
  const secret = process.env.VOICE_SERVICE_SECRET || ''
  if (!secret) return false
  const header = request.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return false
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// A client's visits from today onward, across all their jobs. The date window is
// applied server-side (VisitFilterAttributes.startAt); NO status filter, so today's
// visit — TODAY / LATE / ACTIVE / just COMPLETED — comes back too. The visits
// connection isn't reliably date-sorted, so we pick the earliest in code.
// VisitFilterAttributes has no client filter — hence the client -> jobs -> visits
// traversal (confirmed via introspection).
// The date literal is baked into the query text rather than passed as a variable:
// the nested `Job.visits(filter:)` argument and the root `visits(filter:)` don't
// share a declared input type name we can rely on, and a variable declared with
// the wrong one fails the whole query at validation. `sinceIso` is generated
// server-side (never caller input) and validated to a strict shape below.
const nextVisitQuery = (sinceIso: string) => `
  query AmberNextVisit($clientId: EncodedId!) {
    client(id: $clientId) {
      id
      jobs(first: 50) {
        nodes {
          id
          lineItems(first: 20) { nodes { name totalPrice } }
          visits(first: 10, filter: { startAt: { after: "${sinceIso}" } }) {
            nodes {
              id
              title
              startAt
              endAt
              completedAt
              lineItems(first: 20) { nodes { name totalPrice } }
            }
          }
        }
      }
    }
  }
`

type LineItemLite = { name: string | null; totalPrice: number | null }
type VisitLite = {
  id: string
  title: string | null
  startAt: string | null
  endAt: string | null
  completedAt: string | null
  lineItems?: { nodes?: LineItemLite[] } | null
}
type JobLite = {
  id: string
  lineItems?: { nodes?: LineItemLite[] } | null
  visits?: { nodes?: VisitLite[] } | null
}
type NextVisitResp = {
  data?: { client?: { jobs?: { nodes?: Array<JobLite | null> } } }
}

const CENTRAL = 'America/Chicago'

function centralDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CENTRAL,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function dateLabelForSpeech(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(iso))
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: CENTRAL, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

// Jobber puts an Anytime visit at midnight local time; a real time is anything else.
function isAnytime(iso: string): boolean {
  return timeLabel(iso) === '12:00 AM'
}

// "PTF AM" / "PTF 12-2pm" on the title = a time frame the office promised.
function promisedTimeFrame(title: string | null): string | null {
  const m = (title || '').match(/\bPTF\s+(.+)$/i)
  return m ? m[1].trim() : null
}

function ok(answer: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ answer, ...extra })
}

export async function POST(request: Request) {
  if (!bearerAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { from?: string; to?: string; callSid?: string; request?: string; name?: string; address?: string } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    // no/invalid body — handled below
  }

  const companyId = HEROES_COMPANY_ID
  const admin = createAdminClient()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const address = typeof body.address === 'string' ? body.address.trim() : ''

  // Resolve the caller to a Jobber client: the number they're calling from first
  // (company-scoped local directory match, every phone on the record), then the
  // name on the account + service address if the assistant collected them.
  let jobberClientId: string | null = null
  let matchedBy: 'phone' | 'name' | null = null
  let confirmAddress: string | null = null
  if (body.from) {
    try {
      jobberClientId = (await lookupByPhone(body.from, companyId))?.jobberClientId ?? null
      if (jobberClientId) matchedBy = 'phone'
    } catch {
      // fall through
    }
  }
  if (!jobberClientId && name) {
    try {
      const m = await findClientByNameAndAddress(companyId, name, address || null)
      if (m.status === 'found') {
        jobberClientId = m.jobberClientId
        matchedBy = 'name'
        confirmAddress = m.address
      } else if (m.status === 'ambiguous') {
        return ok(
          address
            ? `More than one account matches the name "${name}" and that address isn't narrowing it down. Ask for the full service address (street number and street name) and try the lookup again with it.`
            : `More than one account matches the name "${name}". Ask for the service address and try the lookup again with both the name and the address.`,
          { found: false, reason: 'ambiguous', count: m.count },
        )
      }
    } catch {
      // treat as not found below
    }
  }

  if (!jobberClientId) {
    if (name) {
      return ok(
        `You couldn't find an account under the name "${name}"${address ? ` at ${address}` : ''} either. Do NOT tell the caller there's 'no account' or 'nothing on file' — that sounds dismissive. Let them know you're not able to pull it up on your end right now, take down exactly what they need, and reassure them a team member will sort it out and follow up.`,
        { found: false, reason: 'not_found' },
      )
    }
    return ok(
      body.from
        ? "This number isn't on an account. Don't say there's 'no account' — the account may be under another name or number. Ask what name the account is under and the service address, then use this tool again passing both `name` and `address`."
        : "There's no caller number on this call. Ask what name the account is under and the service address, then use this tool again passing both `name` and `address`.",
      { found: false, reason: 'no_phone_match' },
    )
  }

  // Live Jobber lookup for the caller's visits from today onward (with line items,
  // and the parent job's line items as a fallback source for the service).
  const today = centralDate(new Date())
  let visits: Array<{ v: VisitLite; jobLineItems: LineItemLite[]; t: number }> = []
  try {
    const userId = await companyJobberUserId(companyId, '')
    if (!userId) throw new Error('no connected Jobber user for company')
    // Padded a day so a visit early today (Central) isn't cut off by the UTC edge;
    // the Central-date check below does the exact work.
    const sinceIso = `${addDaysYmd(today, -1)}T00:00:00Z`
    if (!/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(sinceIso)) throw new Error(`bad since ${sinceIso}`)
    const resp = await jobberGraphQLAdmin<NextVisitResp>(userId, nextVisitQuery(sinceIso), {
      clientId: jobberClientId,
    })
    visits = (resp.data?.client?.jobs?.nodes ?? [])
      .flatMap((j) => (j?.visits?.nodes ?? []).map((v) => ({ v, jobLineItems: j?.lineItems?.nodes ?? [] })))
      .filter((x): x is { v: VisitLite; jobLineItems: LineItemLite[] } => Boolean(x.v && x.v.startAt))
      .filter((x) => centralDate(new Date(x.v.startAt as string)) >= today)
      .map((x) => ({ ...x, t: Date.parse(x.v.startAt as string) }))
      .filter((x) => Number.isFinite(x.t))
      .sort((a, b) => a.t - b.t)
  } catch (err) {
    console.error('[voice.lookup] Jobber query failed', err)
    return ok(
      "You're not able to pull up the schedule right this second. Don't say there's nothing scheduled — tell the caller you can't access it on your end at the moment and a team member will confirm their next visit and follow up.",
      { found: true, reason: 'jobber_error' },
    )
  }

  const settings = await getEffectiveVoiceReceptionistSettings(admin, companyId)
  const describe = (x: { v: VisitLite; jobLineItems: LineItemLite[] }) => {
    const visitItems = (x.v.lineItems?.nodes ?? []).filter(Boolean)
    const items = visitItems.length ? visitItems : x.jobLineItems
    return (
      decodeServiceFromLineItems(items, settings.titleServiceMap)?.say ??
      decodeServiceFromTitle(x.v.title, settings.titleServiceMap)
    )
  }
  const confirmLine = matchedBy === 'name'
    ? ` (You found this account by name${confirmAddress ? ` — the service address on file is ${confirmAddress}; confirm that's them before sharing details` : ' — confirm the service address matches before sharing details'}.)`
    : ''

  const open = visits.filter((x) => !x.v.completedAt)
  const next = open[0]
  if (!next) {
    // Nothing open from today on — but a visit TODAY that's already marked complete
    // is an answer, not a blank ("no one showed up" often means "they came while
    // you were out" or "it was closed out early").
    const doneToday = visits.find((x) => x.v.completedAt && centralDate(new Date(x.v.startAt as string)) === today)
    if (doneToday) {
      const service = describe(doneToday)
      return ok(
        `The caller had a visit scheduled for TODAY${service ? ` (${service})` : ''}, and it's already marked complete in the system${doneToday.v.completedAt ? ` at ${timeLabel(doneToday.v.completedAt)}` : ''}. Tell them that plainly. If they say nobody came, don't argue — take the details, treat it as urgent, and a team member will follow up.${confirmLine}`,
        { found: true, date: 'today', service: service ?? null, completedToday: true },
      )
    }
    return ok(
      `You couldn't pull up an upcoming visit on the account. Don't flatly say 'nothing is scheduled' as if dismissing them — let the caller know you're not able to pull up an upcoming visit on your end, and that a team member will double-check and make sure they're taken care of.${confirmLine}`,
      { found: true, reason: 'no_upcoming_visit' },
    )
  }

  const service = describe(next)
  const startIso = next.v.startAt as string
  const isToday = centralDate(new Date(startIso)) === today
  const dateLabel = isToday ? `TODAY (${dateLabelForSpeech(startIso)})` : dateLabelForSpeech(startIso)
  const ptf = promisedTimeFrame(next.v.title)
  const when = isAnytime(startIso)
    ? ptf
      ? ` It's an anytime visit with a "${ptf}" preference noted for the crew.`
      : ' No exact time is set — it\'s an anytime visit (the arrival window is texted the day before).'
    : ` The arrival window is ${timeLabel(startIso)}${next.v.endAt ? ` to ${timeLabel(next.v.endAt)}` : ''}.`

  const answer = service
    ? `The caller's next scheduled visit is ${dateLabel}, and the service is a ${service}.${when} Share this warmly in your own words.${confirmLine}`
    : `The caller's next scheduled visit is ${dateLabel}.${when} (The service type isn't clear from the schedule, so just give the date and say a team member can confirm what's included.)${confirmLine}`

  return ok(answer, {
    found: true,
    date: dateLabelForSpeech(startIso),
    today: isToday,
    service: service ?? null,
    anytime: isAnytime(startIso),
    ptf,
    matchedBy,
  })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: Boolean(process.env.VOICE_SERVICE_SECRET),
    route: 'voice.lookup',
  })
}
