import { NextResponse } from 'next/server'
import { checkPinCookie } from '@/lib/check-pin-cookie'
import { loadPLData } from '@/lib/qbo-pl'

export type { PLMonth, PLData } from '@/lib/qbo-pl'

export async function GET(request: NextRequest) {
  const denied = await checkPinCookie(request)
  if (denied) return denied

  try {
    const payload = await loadPLData()
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store, no-cache' },
    })
  } catch (err) {
    console.error('QBO PL fetch error', err)
    return NextResponse.json({ error: 'Failed to load data' }, { status: 500 })
  }
}
