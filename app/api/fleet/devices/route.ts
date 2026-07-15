import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getFleetDevices } from '@/lib/onestepgps'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_fleet, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_fleet) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const devices = await getFleetDevices(profile.company_id ?? undefined)
    return NextResponse.json({ devices })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
