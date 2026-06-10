import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveRecentCallId } from '@/lib/dialer-active-call'
import { jobberGraphQLAdmin } from '@/lib/jobber'

const HEROES_COMPANY_ID = process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

const NOTE_CREATE = `
  mutation NoteCreate($input: NoteCreateInput!) {
    noteCreate(input: $input) {
      note { id }
      userErrors { message }
    }
  }
`

// Find any Jobber-connected user in the company so notes post regardless of
// which dialer user is signed in (the connected account is usually just one user).
async function companyJobberUserId(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  preferUserId: string,
): Promise<string | null> {
  const { data: profs } = await admin
    .from('user_profiles')
    .select('id')
    .eq('company_id', companyId)
  const ids = (profs ?? []).map((p) => p.id as string)
  if (ids.length === 0) return null
  const { data: toks } = await admin
    .from('jobber_tokens')
    .select('user_id')
    .in('user_id', ids)
  const tokenUsers = new Set((toks ?? []).map((t) => t.user_id as string))
  if (tokenUsers.has(preferUserId)) return preferUserId
  return tokenUsers.size ? [...tokenUsers][0] : null
}

// POST /api/dialer/calls/note
// Body: { note: string, room?: string, toJobber?: boolean, jobberClientId?: string }
// Writes the note onto the recent call row (lives with the transcript in
// call-log2), and optionally posts it as a Jobber client note.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_dialer, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_dialer) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 5000) : ''
  if (!note) return NextResponse.json({ error: 'note required' }, { status: 400 })
  const toJobber = body.toJobber === true
  const jobberClientId = typeof body.jobberClientId === 'string' ? body.jobberClientId : null

  const companyId = profile.company_id || HEROES_COMPANY_ID
  const admin = createAdminClient()

  // Attach to the recent call row (best-effort — there may be no resolvable row,
  // e.g. a quick note on a call that didn't persist a row).
  const callId = await resolveRecentCallId({
    bodyRoom: typeof body.room === 'string' ? body.room : undefined,
    userId: user.id,
    companyId,
  })
  if (callId) {
    await admin.from('calls').update({ agent_notes: note }).eq('id', callId)
  }

  // Optionally push to Jobber as a client note.
  let jobberPosted = false
  let jobberError: string | null = null
  if (toJobber && jobberClientId) {
    try {
      const jobberUserId = await companyJobberUserId(admin, companyId, user.id)
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

  return NextResponse.json({ ok: true, callId, jobberPosted, jobberError })
}
