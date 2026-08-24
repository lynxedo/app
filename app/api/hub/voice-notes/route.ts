import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import {
  VOICE_NOTE_COLUMNS,
  endOfDayInCompanyTz,
  todayInCompanyTz,
  type VoiceNoteKind,
  type VoiceNoteRow,
} from '@/lib/voice-notes'
import { getSchedulableServices, dateLabelForSpeech, addDaysYmd } from '@/lib/voice-scheduling'

// Amber's "Right Now" notes — the Hub card's read/write API.
//
// Gated on can_admin_ai (requireAdminArea('ai')), matching every other route that
// changes how the assistant behaves. This is deliberately NOT open to all Hub users:
// a note here can stop the company taking bookings or silently re-point the phone, so
// it is an admin action wearing a friendly hat.
//
// The note's spoken `body` is generated HERE, at write time, from the structured
// fields — never at call time. Names and dates are resolved once, by a request that can
// afford a lookup, so app/api/voice/brain stays a single cheap read on the hot path.

export const dynamic = 'force-dynamic'

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

type NoteInput = {
  kind?: string
  body?: string
  cap_date?: string
  cap_service?: string | null
  cap_max_jobs?: number
  out_user_id?: string
  cover_user_id?: string
  /** 'today' | 'tomorrow' | 'date' | 'never' */
  expires?: string
  /** YYYY-MM-DD, when expires === 'date' */
  expires_date?: string
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** Resolve the chip choice into a concrete timestamp (or null = until cancelled). */
function resolveExpiry(input: NoteInput): Date | null | 'invalid' {
  switch (input.expires) {
    case 'never':
      return null
    case 'today':
      return endOfDayInCompanyTz(todayInCompanyTz())
    case 'tomorrow':
      return endOfDayInCompanyTz(addDaysYmd(todayInCompanyTz(), 1))
    case 'date':
      if (!input.expires_date || !YMD_RE.test(input.expires_date)) return 'invalid'
      return endOfDayInCompanyTz(input.expires_date)
    default:
      return 'invalid'
  }
}

async function displayNames(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (ids.length === 0) return out
  const { data } = await admin.from('user_profiles').select('id, full_name').in('id', ids)
  for (const r of (data as { id: string; full_name: string | null }[] | null) ?? []) {
    out[r.id] = (r.full_name || '').trim() || 'a teammate'
  }
  return out
}

export async function GET() {
  const auth = await requireAdminArea('ai')
  if (!auth.ok || !auth.company_id) return bad('forbidden', 403)
  const admin = createAdminClient()
  const companyId = auth.company_id
  const nowIso = new Date().toISOString()

  const [liveRes, recentRes, services, people] = await Promise.all([
    admin
      .from('voice_receptionist_notes')
      .select(VOICE_NOTE_COLUMNS)
      .eq('company_id', companyId)
      .is('cancelled_at', null)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('created_at', { ascending: false }),
    // History feeds the card's one-tap re-add. "We're booked today" is the note Ben
    // will set most often and never wants to retype.
    admin
      .from('voice_receptionist_notes')
      .select(VOICE_NOTE_COLUMNS)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(25),
    getSchedulableServices(admin, companyId).catch(() => []),
    // Offboarded people must not be offered as cover — re-pointing the phone at
    // somebody who has left is worse than leaving it where it was.
    admin
      .from('user_profiles')
      .select('id, full_name')
      .eq('company_id', companyId)
      .is('deactivated_at', null)
      .order('full_name', { ascending: true }),
  ])

  const live = (liveRes.data as VoiceNoteRow[] | null) ?? []
  const liveIds = new Set(live.map((n) => n.id))
  const recent = ((recentRes.data as VoiceNoteRow[] | null) ?? []).filter((n) => !liveIds.has(n.id))

  return NextResponse.json({
    live,
    recent: recent.slice(0, 8),
    services: services.filter((s) => s.enabled).map((s) => s.line_item),
    people: ((people.data as { id: string; full_name: string | null }[] | null) ?? [])
      .map((p) => ({ id: p.id, name: (p.full_name || '').trim() }))
      .filter((p) => p.name.length > 0),
  })
}

export async function POST(request: Request) {
  const auth = await requireAdminArea('ai')
  if (!auth.ok || !auth.company_id || !auth.user) return bad('forbidden', 403)
  const admin = createAdminClient()
  const companyId = auth.company_id

  let input: NoteInput = {}
  try {
    input = (await request.json()) as NoteInput
  } catch {
    return bad('invalid body')
  }

  const kind = input.kind as VoiceNoteKind
  if (kind !== 'text' && kind !== 'booking_cap' && kind !== 'coverage') return bad('unknown kind')

  const row: Record<string, unknown> = {
    company_id: companyId,
    kind,
    created_by: auth.user.id,
  }

  if (kind === 'text') {
    const body = (input.body || '').trim()
    if (!body) return bad('Type what you want to tell her.')
    if (body.length > 500) return bad('Keep it under 500 characters.')
    row.body = body

    const exp = resolveExpiry(input)
    if (exp === 'invalid') return bad('Pick when this should expire.')
    row.expires_at = exp ? exp.toISOString() : null
  }

  if (kind === 'booking_cap') {
    const capDate = input.cap_date || ''
    if (!YMD_RE.test(capDate)) return bad('Pick the day this applies to.')
    const max = Number(input.cap_max_jobs)
    if (!Number.isInteger(max) || max < 0 || max > 100) return bad('How many jobs? Use a whole number.')
    const service = (input.cap_service || '').trim()

    // ⚠ A NUMERIC CAP MUST NAME A SERVICE. The cap is applied per service (each one is
    // counted against its own limit), so "all services, 4" would mean "4 irrigation AND
    // 4 mowing AND 4 of everything else" — which is not what anybody typing 4 means.
    // "All services" is therefore only offered as a full stop for the day, which is
    // exactly Ben's *"we are booked for today. Do not book any more."*
    if (!service && max > 0) {
      return bad('Pick a service for a numeric limit — "All services" can only close the day.')
    }

    row.cap_date = capDate
    row.cap_service = service || null
    row.cap_max_jobs = max
    row.body =
      max === 0
        ? service
          ? `No more ${service} bookings on ${dateLabelForSpeech(capDate)} — that day is full for ${service}.`
          : `We are fully booked on ${dateLabelForSpeech(capDate)} — do not put any more jobs on that day. Offering a later day is fine.`
        : `Up to ${max} ${service} ${max === 1 ? 'job' : 'jobs'} may be booked for ${dateLabelForSpeech(capDate)}.`

    // A capacity note is meaningless once its day is past, so its lifetime IS its day.
    // Not a chip the user can get wrong.
    row.expires_at = endOfDayInCompanyTz(capDate).toISOString()
  }

  if (kind === 'coverage') {
    const outId = (input.out_user_id || '').trim()
    const coverId = (input.cover_user_id || '').trim()
    if (!outId || !coverId) return bad('Pick who is out and who is covering.')
    if (outId === coverId) return bad("That's the same person — pick someone else to cover.")

    const names = await displayNames(admin, [outId, coverId])
    row.out_user_id = outId
    row.cover_user_id = coverId
    row.body = `${names[outId] ?? 'A teammate'} is out — send their calls to ${names[coverId] ?? 'the covering teammate'} instead.`

    const exp = resolveExpiry(input)
    if (exp === 'invalid') return bad('Pick when they are back.')
    row.expires_at = exp ? exp.toISOString() : null
  }

  const { data, error } = await admin
    .from('voice_receptionist_notes')
    .insert(row)
    .select(VOICE_NOTE_COLUMNS)
    .single()
  if (error) {
    console.error('[voice-notes] insert failed', error)
    return bad("Couldn't save that note.", 500)
  }
  return NextResponse.json({ note: data })
}

export async function DELETE(request: Request) {
  const auth = await requireAdminArea('ai')
  if (!auth.ok || !auth.company_id) return bad('forbidden', 403)
  const id = new URL(request.url).searchParams.get('id') || ''
  if (!id) return bad('missing id')

  const admin = createAdminClient()
  // Soft cancel — the row stays so it can be re-added from history in one tap, and so
  // there is a record of what the receptionist was told and when.
  const { error } = await admin
    .from('voice_receptionist_notes')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', auth.company_id) // never let an id from another tenant be cancelled
  if (error) {
    console.error('[voice-notes] cancel failed', error)
    return bad("Couldn't remove that note.", 500)
  }
  return NextResponse.json({ ok: true })
}
