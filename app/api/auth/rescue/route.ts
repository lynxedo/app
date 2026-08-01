import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Break-glass admin login. Lets ONE hard-coded admin account establish a real session
// WITHOUT touching Supabase's per-IP rate-limited /token endpoint — the escape hatch for
// the refresh-storm lockout (see the 2026-08-01 sign-in incident). The session is minted
// entirely server-side: admin generateLink() (service role) -> verifyOtp() which hits
// /verify, and both run from the VPS, so a stormed *client* IP can never block it.
//
// SECURITY:
//  - Fail-closed: the route 404s unless BREAKGLASS_SECRET is set in the server env
//    (never committed — set it in .env.local on the VPS).
//  - Scoped to a single hard-coded account. It cannot log anyone else in.
//  - Constant-time secret comparison; a deliberate delay + logging on failure.
//  - Not linked anywhere; the secret is the real lock.
const ADMIN_EMAIL = 'ben@heroeslawntx.com'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function page(message?: string, isError = true): string {
  const note = message
    ? `<p style="color:${isError ? '#f87171' : '#34d399'};font-size:14px;margin:0 0 12px">${message}</p>`
    : ''
  // Deliberately self-contained (no app chrome / no client JS) so it renders even when the
  // rest of the app or the session layer is misbehaving.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Emergency sign-in</title></head>
<body style="background:#0a0f1a;color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center">
<form method="POST" style="width:100%;max-width:360px;padding:24px;box-sizing:border-box">
<h1 style="font-size:18px;font-weight:700;margin:0 0 16px">Emergency sign-in</h1>
${note}
<input name="secret" type="password" placeholder="Break-glass passphrase" autocomplete="off" autofocus required
 style="width:100%;padding:12px;border-radius:8px;border:1px solid #374151;background:#111827;color:#fff;font-size:16px;box-sizing:border-box">
<button type="submit" style="width:100%;margin-top:12px;padding:12px;border-radius:8px;border:0;background:#f59e0b;color:#0a0f1a;font-weight:700;font-size:16px;cursor:pointer">Sign me in</button>
</form></body></html>`
}

function html(body: string, status = 200): NextResponse {
  return new NextResponse(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

export async function GET() {
  if (!process.env.BREAKGLASS_SECRET) return new NextResponse('Not found', { status: 404 })
  return html(page())
}

export async function POST(request: Request) {
  const secret = process.env.BREAKGLASS_SECRET
  if (!secret) return new NextResponse('Not found', { status: 404 })

  const form = await request.formData().catch(() => null)
  const provided = form ? String(form.get('secret') ?? '') : ''

  if (!provided || !secretsMatch(provided, secret)) {
    console.warn(`[break-glass] FAILED attempt ${new Date().toISOString()}`)
    await new Promise((r) => setTimeout(r, 1500)) // blunt brute-forcing
    return html(page('Incorrect passphrase.'), 401)
  }

  // Mint the session server-side, off the rate-limited /token path.
  const admin = createAdminClient()
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: ADMIN_EMAIL,
  })
  const tokenHash = link?.properties?.hashed_token
  if (linkErr || !tokenHash) {
    console.error('[break-glass] generateLink failed', linkErr)
    return html(page('Could not create a session. Try again in a moment.'), 500)
  }

  const supabase = await createClient()
  const { error: verifyErr } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
  if (verifyErr) {
    console.error('[break-glass] verifyOtp failed', verifyErr)
    return html(page('Could not establish the session. Try again.'), 500)
  }

  console.warn(`[break-glass] SUCCESS for ${ADMIN_EMAIL} ${new Date().toISOString()}`)
  return NextResponse.redirect(`${APP_URL}/hub`, { status: 303 })
}
