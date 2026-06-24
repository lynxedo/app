import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyUnsubToken } from '@/lib/email-unsubscribe'
import { suppressEmail } from '@/lib/email-contacts'
import { recordUnsubscribeEvent } from '@/lib/email-events'

// One-click unsubscribe endpoint (RFC 8058 List-Unsubscribe-Post target).
// Public, no auth — the signed token is the authorization.
export async function POST(request: NextRequest) {
  let token: string | null = null
  try {
    const form = await request.formData().catch(() => null)
    token = (form?.get('token') as string) || null
  } catch { /* ignore */ }
  if (!token) token = new URL(request.url).searchParams.get('token')

  const claim = verifyUnsubToken(token)
  if (!claim) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 400 })

  const admin = createAdminClient()
  const ok = await suppressEmail(admin, claim.companyId, claim.email, 'unsubscribe')
  if (!ok) return NextResponse.json({ error: 'Could not process unsubscribe' }, { status: 500 })
  await recordUnsubscribeEvent(admin, claim.companyId, claim.campaignId, claim.email)
  return NextResponse.json({ ok: true })
}

// Redirect bare API GETs to the friendly page.
export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token') || ''
  return NextResponse.redirect(new URL(`/unsubscribe?token=${encodeURIComponent(token)}`, request.url))
}
