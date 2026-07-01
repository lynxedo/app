import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FeedbackView from './FeedbackView'

export const metadata = { title: 'Report an Issue' }
export const dynamic = 'force-dynamic'

// Open to every signed-in Hub user (no permission gate) — the whole point is to
// collect bug reports + feature requests from the whole team. Submissions land
// on the Development board via /api/hub/feedback (admin-scoped write).
export default async function FeedbackPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) redirect('/hub')

  return <FeedbackView />
}
