import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { importMailchimpCsv } from '@/lib/email-contacts'

export const maxDuration = 120

// Upload a Mailchimp CSV export (subscribed / unsubscribed / cleaned). List type
// is auto-detected from the header. Returns a created/updated/suppressed summary.
export async function POST(request: NextRequest) {
  const check = await requireAdminArea('email')
  if (!check.ok || !check.company_id || !check.user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let form: FormData
  try { form = await request.formData() } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'File too large (max 25MB)' }, { status: 400 })

  const csvText = await file.text()
  const admin = createAdminClient()
  try {
    const summary = await importMailchimpCsv(admin, {
      companyId: check.company_id,
      userId: check.user.id,
      filename: file.name || 'upload.csv',
      csvText,
    })
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'import_failed' }, { status: 500 })
  }
}
