import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail, formatFrom, resendConfigured } from '@/lib/resend'
import { renderMergeFields } from '@/lib/email-markdown'
import { normalizeDesign, isEmptyDesign, renderDesignToHtml } from '@/lib/email-blocks'

// Send a verified test email to the signed-in user. Gated on can_access_email
// (admins always). Uses the company's configured sending identity from
// email_settings. Surfaces Resend's error verbatim so a misconfigured domain is
// obvious during setup.
//
// Body (optional): { subject, body_markdown } — when present, sends a "test to
// myself" of the template being edited, with merge fields rendered against the
// caller's own name. With no body it sends the original wiring-check message.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_email, role, full_name')
    .eq('id', user.id)
    .maybeSingle()

  const canAccess = profile?.role === 'admin' || profile?.can_access_email === true
  if (!canAccess || !profile?.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!resendConfigured()) {
    return NextResponse.json({ error: 'Email sending is not configured yet (RESEND_API_KEY missing). Add it on the server, then try again.' }, { status: 400 })
  }
  if (!user.email) {
    return NextResponse.json({ error: 'Your account has no email address to send the test to.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: settings } = await admin
    .from('email_settings')
    .select('from_name, from_email, reply_to, domain_verified')
    .eq('company_id', profile.company_id)
    .maybeSingle()

  if (!settings?.from_email) {
    return NextResponse.json({ error: 'No sending address configured. Set the From address in Admin → Email Marketing first.' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const tplSubject = typeof body?.subject === 'string' ? body.subject.trim() : ''
  const design = normalizeDesign(body?.design)
  const isTemplateTest = !isEmptyDesign(design) || tplSubject !== ''

  // Merge context = the caller's own name, so {{first_name}} renders realistically.
  const [first, ...rest] = (profile?.full_name || '').trim().split(/\s+/)
  const mergeCtx = { first_name: first || null, last_name: rest.join(' ') || null, email: user.email }

  let subject: string
  let html: string
  let text: string

  if (isTemplateTest) {
    subject = `[TEST] ${renderMergeFields(tplSubject || '(no subject)', mergeCtx)}`
    // Render the block design to email-safe HTML with this request's origin so
    // uploaded images/logos resolve, and merge fields filled with the caller's name.
    html = renderDesignToHtml(design, { baseUrl: new URL(request.url).origin, merge: mergeCtx })
    text = 'This is a test send of a draft email template, delivered only to you.'
  } else {
    subject = 'Lynxedo Email — test message'
    html = `<div style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">
      <p>This is a test from your Lynxedo Email Marketing module. 🎉</p>
      <p>If you received this, your sending identity is wired up:</p>
      <ul>
        <li><strong>From:</strong> ${formatFrom(settings.from_name, settings.from_email)}</li>
        <li><strong>Reply-To:</strong> ${settings.reply_to || '(none)'}</li>
        <li><strong>Domain verified:</strong> ${settings.domain_verified ? 'yes' : 'no'}</li>
      </ul>
      <p style="color:#666;font-size:13px">Sent by Lynxedo. No action needed.</p>
    </div>`
    text = 'This is a test from your Lynxedo Email Marketing module. If you received it, your sending identity is wired up.'
  }

  const result = await sendEmail({
    from: formatFrom(settings.from_name, settings.from_email),
    to: user.email,
    replyTo: settings.reply_to || undefined,
    subject,
    html,
    text,
    tags: [{ name: 'type', value: 'test' }],
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }
  return NextResponse.json({ ok: true, id: result.id, sent_to: user.email })
}
