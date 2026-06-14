import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { jobberGraphQL, isJobberConnected } from '@/lib/jobber'
import { formatSubmissionAsText, renderSmsTemplate } from '@/lib/forms'
import type { Form } from '@/lib/forms'
import { sendSms, toE164 } from '@/lib/twilio'
import { resolveFromNumber } from '@/lib/txt-numbers'

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

  // Tech display name — used for both the Jobber note and the customer SMS.
  const { data: hubUserRow } = await admin
    .from('hub_users')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle()
  const techName = hubUserRow?.display_name ?? 'Technician'

  // Best-effort Jobber note creation
  let jobberNoteId: string | null = null
  let jobberError: string | null = null

  if (body.jobber_client_id && await isJobberConnected(user.id)) {
    try {
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

  // MSC-FormsSend: auto-send the customer SMS the form built, server-side via the same
  // Twilio path everything else uses — techs used to copy-paste it by hand. Respects
  // do_not_text and resolves the right "from" number; on any failure we still return the
  // body so the success screen can offer manual copy as a fallback.
  let smsSent = false
  let smsError: string | null = null
  let smsBody: string | null = null
  if (form.notification_sms_template && body.customer_name && body.customer_phone) {
    const fields = (form.fields ?? []) as { id: string; type: string }[]
    const dateField = fields.find(f => f.type === 'date')
    const dateVal = dateField ? (body.answers?.[dateField.id] as string | undefined) : undefined
    smsBody = renderSmsTemplate(form.notification_sms_template, {
      customer_name: body.customer_name,
      tech_name: techName,
      date: dateVal
        ? new Date(dateVal + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : new Date().toLocaleDateString(),
    })
    const toPhone = toE164(body.customer_phone)
    if (!toPhone) {
      smsError = 'invalid_phone'
    } else {
      const { data: contact } = await admin
        .from('txt_contacts')
        .select('do_not_text')
        .eq('company_id', profile.company_id)
        .eq('phone', toPhone)
        .maybeSingle()
      if (contact?.do_not_text) {
        smsError = 'do_not_text'
      } else {
        const fromNumber = (await resolveFromNumber(admin, { userId: user.id, companyId: profile.company_id })) ?? undefined
        const result = await sendSms({ to: toPhone, body: smsBody, fromNumber })
        if (result.ok) smsSent = true
        else smsError = result.error ?? 'send_failed'
      }
    }
  }

  return NextResponse.json({
    submission,
    jobber_note_id: jobberNoteId,
    jobber_error: jobberError,
    sms_sent: smsSent,
    sms_error: smsError,
    sms_body: smsBody,
  }, { status: 201 })
}
