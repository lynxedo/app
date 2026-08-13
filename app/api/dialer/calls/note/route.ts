import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveRecentCallId } from '@/lib/dialer-active-call'
import { CENTRAL_TZ } from '@/lib/timezone'
import { jobberGraphQLAdmin, companyJobberUserId } from '@/lib/jobber'

const HEROES_COMPANY_ID = process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

const NOTE_CREATE = `
  mutation NoteCreate($input: NoteCreateInput!) {
    noteCreate(input: $input) {
      note { id }
      userErrors { message }
    }
  }
`

// companyJobberUserId now lives in lib/jobber.ts (shared with Daily Log v2).

// Notes taken on a call.
//
//   GET  /api/dialer/calls/note?room=…  → what's already on this call
//   POST /api/dialer/calls/note         → append a note
//
// ⚠ Aug 13 2026 — two things were wrong here:
//
//  1. POST OVERWROTE `agent_notes`. It's a single text column, so a second note
//     on the same call silently replaced the first. Now each note is APPENDED
//     with a timestamp, so a long call reads as a running list.
//  2. Nothing ever READ the column back — no route selected it and no screen
//     rendered it. Every note typed since the feature shipped was written and
//     then invisible. The GET here plus the Call Log detail close that.
//
// Kept as one column rather than a `call_notes` table: no migration, and the
// existing rows stay readable as-is. If notes ever need per-author attribution
// or individual editing, that's the moment to promote them to a table.
function noteTimestamp(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL_TZ,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date())
}

function appendNote(existing: string | null, note: string): string {
  const entry = `[${noteTimestamp()}] ${note}`
  const prior = (existing || '').trim()
  return prior ? `${prior}\n${entry}` : entry
}

async function gate() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized', status: 401 as const }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_dialer, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_dialer) {
    return { error: 'forbidden', status: 403 as const }
  }
  return { user, companyId: (profile.company_id as string) || HEROES_COMPANY_ID }
}

// What's already been noted on this call — so the notepad can show it rather
// than looking empty on a reconnect or a second visit to the same call.
export async function GET(request: Request) {
  const g = await gate()
  if ('error' in g) return NextResponse.json({ error: g.error }, { status: g.status })

  const { searchParams } = new URL(request.url)
  const room = searchParams.get('room') || undefined

  const callId = await resolveRecentCallId({ bodyRoom: room, userId: g.user.id, companyId: g.companyId })
  if (!callId) return NextResponse.json({ callId: null, notes: '' })

  const admin = createAdminClient()
  const { data } = await admin.from('calls').select('agent_notes').eq('id', callId).maybeSingle()
  return NextResponse.json({ callId, notes: (data?.agent_notes as string | null) || '' })
}

// Body: { note: string, room?: string, toJobber?: boolean, jobberClientId?: string }
// Appends the note to the call row (shown in the Call Log detail), and
// optionally posts it as a Jobber client note.
export async function POST(request: Request) {
  const g = await gate()
  if ('error' in g) return NextResponse.json({ error: g.error }, { status: g.status })
  const { user, companyId } = g

  const body = await request.json().catch(() => ({}))
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 5000) : ''
  if (!note) return NextResponse.json({ error: 'note required' }, { status: 400 })
  const toJobber = body.toJobber === true
  const jobberClientId = typeof body.jobberClientId === 'string' ? body.jobberClientId : null

  const admin = createAdminClient()

  // Attach to the call row. `room` matters: without it resolveRecentCallId falls
  // back to "this user's most recent call in the last 6 hours", which can be a
  // DIFFERENT call if another one has since come in. The notepad passes the live
  // conference room so the note lands on the call it was typed during.
  const callId = await resolveRecentCallId({
    bodyRoom: typeof body.room === 'string' ? body.room : undefined,
    userId: user.id,
    companyId,
  })
  let notes: string | null = null
  if (callId) {
    const { data: current } = await admin
      .from('calls')
      .select('agent_notes')
      .eq('id', callId)
      .maybeSingle()
    notes = appendNote((current?.agent_notes as string | null) ?? null, note)
    await admin.from('calls').update({ agent_notes: notes }).eq('id', callId)
  }

  // Optionally push to Jobber as a client note.
  let jobberPosted = false
  let jobberError: string | null = null
  if (toJobber && jobberClientId) {
    try {
      const jobberUserId = await companyJobberUserId(companyId, user.id)
      if (!jobberUserId) {
        jobberError = 'No connected Jobber account'
      } else {
        const res = await jobberGraphQLAdmin<{
          data?: { noteCreate?: { userErrors?: { message: string }[] } }
        }>(jobberUserId, NOTE_CREATE, {
          input: { subjectType: 'CLIENT', subjectId: jobberClientId, content: note },
        })
        const errs = res?.data?.noteCreate?.userErrors
        if (errs && errs.length) jobberError = errs.map((e) => e.message).join('; ')
        else jobberPosted = true
      }
    } catch (e) {
      jobberError = e instanceof Error ? e.message : 'Jobber note failed'
    }
  }

  return NextResponse.json({ ok: true, callId, notes, jobberPosted, jobberError })
}
