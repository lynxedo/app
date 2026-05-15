import { NextRequest, NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { verifyPin } from '@/lib/pin'

const COOKIE_NAME = 'books_unlocked'
const EIGHT_HOURS = 60 * 60 * 8

function getSecret() {
  return new TextEncoder().encode(process.env.COOKIE_SECRET!)
}

export async function POST(request: NextRequest) {
  // CSRF: origin must match app URL
  const origin = request.headers.get('origin')
  if (origin !== process.env.NEXT_PUBLIC_APP_URL) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const pin: string = body?.pin ?? ''

  const valid = await verifyPin(pin)

  if (!valid) {
    await new Promise(r => setTimeout(r, 3000))
    return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 })
  }

  const token = await new SignJWT({ books: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(getSecret())

  const response = NextResponse.json({ ok: true })
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: true,
    maxAge: EIGHT_HOURS,
    path: '/',
  })
  return response
}
