import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAccessibleNumberIds } from '@/lib/phone-number-access'

// GET /api/txt/numbers — list this company's Txt phone numbers so the
// per-conversation override picker in TxtConversationView can render the
// dropdown. RLS on txt_phone_numbers already enforces same-company; we
// just need the auth check to fail loud rather than return an empty list.
//
// Number access (multi-number scope): a plain Txt2 user only gets the numbers
// they're granted in user_phone_number_access (so the "from" picker can't offer
// a line they don't work). Managers/admins always get the full list.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('txt_phone_numbers')
    .select('id, twilio_number, label, is_default')
    .order('is_default', { ascending: false })
    .order('label', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_txt, can_assign_txt_threads')
    .eq('id', user.id)
    .single()
  const isManager =
    profile?.role === 'admin' ||
    profile?.can_admin_txt === true ||
    profile?.can_assign_txt_threads === true

  let numbers = data || []
  if (!isManager) {
    const scope = await getAccessibleNumberIds(createAdminClient(), user.id)
    if (scope) numbers = numbers.filter((n) => scope.includes(n.id))
  }

  return NextResponse.json({ numbers })
}
