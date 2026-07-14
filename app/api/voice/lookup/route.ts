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
// Auth: same Bearer VOICE_SERVICE_SECRET as /api/voice/brain + /api/voice/wrapup.

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { lookupByPhone } from '@/lib/dialer-lookup'
import { jobberGraphQLAdmin, companyJobberUserId } from '@/lib/jobber'
import { getEffectiveVoiceReceptionistSettings } from '@/lib/voice-receptionist-settings'
import { decodeServiceFromTitle, decodeServiceFromLineItems } from '@/lib/voice-receptionist'

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

// A client's upcoming visits across all their jobs. Filtered server-side to
// UPCOMING (VisitStatusTypeEnum) so completed/past visits never come back; the
// visits connection isn't reliably date-sorted, so we pick the earliest in code.
// VisitFilterAttributes has no client filter — hence the client -> jobs -> visits
// traversal (both confirmed via introspection).
const NEXT_VISIT_QUERY = `
  query AmberNextVisit($clientId: EncodedId!) {
    client(id: $clientId) {
      id
      jobs(first: 30) {
        nodes {
          id
          lineItems(first: 20) { nodes { name totalPrice } }
          visits(first: 5, filter: { status: UPCOMING }) {
            nodes {
              id
              title
              startAt
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

function ok(answer: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ answer, ...extra })
}

export async function POST(request: Request) {
  if (!bearerAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { from?: string; to?: string; callSid?: string; request?: string } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    // no/invalid body — handled below
  }

  const companyId = HEROES_COMPANY_ID
  const admin = createAdminClient()

  if (!body.from) {
    return ok(
      "There's no caller number on this call, so I can't pull up an account. Tell the caller you'll take their details and have a team member check for them.",
    )
  }

  // Resolve the caller to a Jobber client (company-scoped local directory match).
  let jobberClientId: string | null = null
  try {
    const match = await lookupByPhone(body.from, companyId)
    jobberClientId = match?.jobberClientId ?? null
  } catch {
    // fall through to not-found
  }

  if (!jobberClientId) {
    return ok(
      "I don't see an existing customer account under the number they're calling from. If they say they're already a customer, the account may be under a different phone — take their details so a team member can confirm.",
    )
  }

  // Live Jobber lookup for the caller's next upcoming visit (with its line items,
  // and the parent job's line items as a fallback source for the service).
  let nextVisit: VisitLite | null = null
  let nextVisitLineItems: LineItemLite[] = []
  try {
    const userId = await companyJobberUserId(companyId, '')
    if (!userId) throw new Error('no connected Jobber user for company')
    const resp = await jobberGraphQLAdmin<NextVisitResp>(userId, NEXT_VISIT_QUERY, {
      clientId: jobberClientId,
    })
    const today = centralDate(new Date())
    const upcoming = (resp.data?.client?.jobs?.nodes ?? [])
      // carry each visit alongside its parent job's line items
      .flatMap((j) =>
        (j?.visits?.nodes ?? []).map((v) => ({ v, jobLineItems: j?.lineItems?.nodes ?? [] })),
      )
      .filter(
        (x): x is { v: VisitLite; jobLineItems: LineItemLite[] } =>
          Boolean(x.v && x.v.startAt && !x.v.completedAt),
      )
      // keep visits whose Central calendar date is today or later
      .filter((x) => centralDate(new Date(x.v.startAt as string)) >= today)
      .map((x) => ({ ...x, t: Date.parse(x.v.startAt as string) }))
      .filter((x) => Number.isFinite(x.t))
      .sort((a, b) => a.t - b.t)
    if (upcoming.length) {
      nextVisit = upcoming[0].v
      // Prefer the visit's own line items; fall back to the parent job's.
      const visitItems = (nextVisit.lineItems?.nodes ?? []).filter(Boolean)
      nextVisitLineItems = visitItems.length ? visitItems : upcoming[0].jobLineItems
    }
  } catch (err) {
    console.error('[voice.lookup] Jobber query failed', err)
    return ok(
      "I'm having trouble pulling up the schedule right this second. Tell the caller a team member will confirm their next visit on the follow-up.",
    )
  }

  if (!nextVisit) {
    return ok(
      "There's no upcoming visit scheduled on the account right now. Let the caller know a team member will double-check and get them set up.",
    )
  }

  // Name the service from the visit's LINE ITEMS (the real services on the job),
  // using the company's configurable rules (Admin → AI → Receptionist). Falls back
  // to decoding the visit title only if the visit carries no recognizable line
  // items. Null when nothing matches — the caller then just hears the date.
  const settings = await getEffectiveVoiceReceptionistSettings(admin, companyId)
  const service =
    decodeServiceFromLineItems(nextVisitLineItems, settings.titleServiceMap)?.say ??
    decodeServiceFromTitle(nextVisit.title, settings.titleServiceMap)
  const dateLabel = dateLabelForSpeech(nextVisit.startAt as string)

  const answer = service
    ? `The caller's next scheduled visit is ${dateLabel}, and the service is a ${service}. Share this warmly in your own words.`
    : `The caller's next scheduled visit is ${dateLabel}. (The service type isn't clear from the schedule, so just give the date and say a team member can confirm what's included.)`

  return ok(answer, { date: dateLabel, service: service ?? null })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: Boolean(process.env.VOICE_SERVICE_SECRET),
    route: 'voice.lookup',
  })
}
