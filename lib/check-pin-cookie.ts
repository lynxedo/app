import { jwtVerify } from 'jose'
import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = 'books_unlocked'

function getSecret() {
  return new TextEncoder().encode(process.env.COOKIE_SECRET!)
}

export async function checkPinCookie(request: NextRequest): Promise<NextResponse | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await jwtVerify(token, getSecret())
    return null // valid — caller proceeds
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
