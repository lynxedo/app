import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail, formatFrom, resendConfigured } from '@/lib/resend'

// Send a verified test email to the signed-in user. Gated on can_access_email
// (admins always). Uses the company's configured sending identity from
// email_settings. Surfaces Resend's error verbatim so a misconfigured domain is
// obvious during setup.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_email, role')
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

  const result = await sendEmail({
    from: formatFrom(settings.from_name, settings.from_email),
    to: user.email,
    replyTo: settings.reply_to || undefined,
    subject: 'Lynxedo Email — test message',
    html: `<div style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">
      <p>This is a test from your Lynxedo Email Marketing module. 🎉</p>
      <p>If you received this, your sending identity is wired up:</p>
      <ul>
        <li><strong>From:</strong> ${formatFrom(settings.from_name, settings.from_email)}</li>
        <li><strong>Reply-To:</strong> ${settings.reply_to || '(none)'}</li>
        <li><strong>Domain verified:</strong> ${settings.domain_verified ? 'yes' : 'no'}</li>
      </ul>
      <p style="color:#666;font-size:13px">Sent by Lynxedo. No action needed.</p>
    </div>`,
    text: 'This is a test from your Lynxedo Email Marketing module. If you received it, your sending identity is wired up.',
    tags: [{ name: 'type', value: 'test' }],
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }
  return NextResponse.json({ ok: true, id: result.id, sent_to: user.email })
}
