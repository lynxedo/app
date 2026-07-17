import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBusinessProfile } from '@/lib/business-profile'

// Returns the current user's company business profile (business name, city,
// phone, etc.) for client components that compose customer-facing copy — e.g.
// the Dialer "on my way" text in CallContactCard. Read-only; the resolver always
// falls back to the current Heroes values, so a signed-in Heroes user gets
// exactly today's strings.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()

  const admin = createAdminClient()
  const businessProfile = await getBusinessProfile(admin, profile?.company_id ?? null)
  return NextResponse.json(businessProfile)
}
