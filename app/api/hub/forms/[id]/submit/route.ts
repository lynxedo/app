import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { jobberGraphQL, isJobberConnected } from '@/lib/jobber'
import { formatSubmissionAsText } from '@/lib/forms'
import type { Form } from '@/lib/forms'

export const dynamic = 'force-dynamic'

const NOTE_CREATE = `
  mutation NoteCreate($input: NoteCreateInput!) {
    noteCreate(input: $input) {
      note { id }
      userErrors { message path }
    }
  }
`

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_forms')
    .eq('id', user.id)
    .single()

  if (!profile?.can_access_forms) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: {
    answers?: Record<string, string | boolean>
    customer_name?: string
    customer_phone?: string
    jobber_client_id?: string
    context_type?: string
    context_id?: string
  } = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Fetch the form to validate it belongs to this company
  const { data: form, error: formErr } = await admin
    .from('forms')
    .select('*')
    .eq('id', id)
    .eq('company_id', profile.company_id)
    .single()

  if (formErr || !form) return NextResponse.json({ error: 'Form not found' }, { status: 404 })

  const submittedAt = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })

  // Create the submission
  const { data: submission, error: subErr } = await admin
    .from('form_submissions')
    .insert({
      form_id: id,
      company_id: profile.company_id,
      context_type: body.context_type ?? 'manual',
      context_id: body.context_id ?? null,
      answers: body.answers ?? {},
      submitted_by: user.id,
      customer_name: body.customer_name ?? null,
      customer_phone: body.customer_phone ?? null,
      jobber_client_id: body.jobber_client_id ?? null,
    })
    .select()
    .single()

  if (subErr) return NextResponse.json({ error: subErr.message }, { status: 500 })

  // Best-effort Jobber note creation
  let jobberNoteId: string | null = null
  let jobberError: string | null = null

  if (body.jobber_client_id && await isJobberConnected(user.id)) {
    try {
      const hubUser = await supabase
        .from('hub_users')
        .select('display_name')
        .eq('id', user.id)
        .single()
      const techName = hubUser.data?.display_name ?? 'Technician'

      const noteContent = formatSubmissionAsText(form as Form, body.answers ?? {}, {
        techName,
        customerName: body.customer_name,
        submittedAt,
      })

      const result = await jobberGraphQL<{
        data: { noteCreate: { note: { id: string } | null; userErrors: { message: string }[] } }
      }>(user.id, NOTE_CREATE, {
        input: {
          subjectType: 'CLIENT',
          subjectId: body.jobber_client_id,
          content: noteContent,
        },
      })

      const noteData = result?.data?.noteCreate
      if (noteData?.note?.id) {
        jobberNoteId = noteData.note.id
        await admin
          .from('form_submissions')
          .update({ jobber_note_id: jobberNoteId })
          .eq('id', submission.id)
      } else if (noteData?.userErrors?.length) {
        jobberError = noteData.userErrors.map((e: { message: string }) => e.message).join(', ')
      }
    } catch (e: unknown) {
      jobberError = e instanceof Error ? e.message : 'Jobber sync failed'
      console.error('Form submission Jobber note failed:', jobberError)
    }
  }

  return NextResponse.json({
    submission,
    jobber_note_id: jobberNoteId,
    jobber_error: jobberError,
  }, { status: 201 })
}
