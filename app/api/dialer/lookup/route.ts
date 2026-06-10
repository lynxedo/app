import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { lookupByPhone } from '@/lib/dialer-lookup'

// GET /api/dialer/lookup?phone=+1XXXXXXXXXX
// Reverse-lookup an inbound/outbound number to a customer identity for the
// dialer screen-pop. Dialer-gated. Returns { match: DialerLookupMatch | null }.
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_dialer, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_dialer) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const phone = new URL(request.url).searchParams.get('phone') || ''
  if (!phone) return NextResponse.json({ match: null })

  try {
    const match = await lookupByPhone(phone, profile.company_id)
    return NextResponse.json({ match })
  } catch {
    // Never let a lookup failure block the call UI — degrade to "unknown".
    return NextResponse.json({ match: null })
  }
}
