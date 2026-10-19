import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { companyJobberUserId } from '@/lib/jobber'
import { fetchTechDayStops } from '@/lib/jobber-day-stops'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  const assignedTo = searchParams.get('userId')

  if (!date || !assignedTo)
    return NextResponse.json({ error: 'date and userId are required' }, { status: 400 })

  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const { companyId, userId } = auth

  // Jobber is connected per COMPANY, not per user. `jobber_tokens` is RLS'd to
  // `auth.uid() = user_id`, so asking for the signed-in user's own token answers
  // "did *I* personally connect Jobber" — null for everyone except the one person
  // who did. Resolve the company's connected account and go through the admin
  // client instead (see companyJobberUserId in lib/jobber.ts).
  const jobberUserId = await companyJobberUserId(companyId, userId)
  if (!jobberUserId) {
    return NextResponse.json({ error: 'Jobber is not connected for your company' }, { status: 400 })
  }

  try {
    const out = await fetchTechDayStops(jobberUserId, date, assignedTo)
    if ('error' in out) return NextResponse.json({ error: out.error }, { status: 400 })
    const { stops, truncated } = out
    return NextResponse.json({ visits: stops, truncated })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
