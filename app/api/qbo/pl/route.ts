import { NextRequest, NextResponse } from 'next/server'
import { checkPinCookie } from '@/lib/check-pin-cookie'
import { loadPLData } from '@/lib/qbo-pl'
import { resolveSessionCompanyId } from '@/lib/company-auth'
import { QBO_FALLBACK_COMPANY_ID } from '@/lib/qbo'

export type { PLMonth, PLData } from '@/lib/qbo-pl'

export async function GET(request: NextRequest) {
  const denied = await checkPinCookie(request)
  if (denied) return denied

  try {
    // Scope the QBO read to the caller's own company (Books runs under the Hub
    // session; Heroes falls back to itself if the session can't be resolved).
    const companyId = await resolveSessionCompanyId(QBO_FALLBACK_COMPANY_ID)
    const payload = await loadPLData(companyId)
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store, no-cache' },
    })
  } catch (err) {
    console.error('QBO PL fetch error', err)
    return NextResponse.json({ error: 'Failed to load data' }, { status: 500 })
  }
}
