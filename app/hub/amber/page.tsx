import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AmberNotesCard from '@/components/hub/home/AmberNotesCard'

// Amber's "Right Now" screen — its own Hub destination.
//
// It first shipped as a card on /hub/home, which was a mistake: `/hub` redirects to
// your last room (or #general), NOTHING in the nav links to /hub/home, and the sidebar
// is deliberately hidden there — so Home is a once-a-morning screen you reach only via
// the 14-hour idle bounce. Ben: *"I'm not seeing this in Hub anywhere"* → *"we need to
// put it in the hub. right along with task boards, rooms and DMs."* So it now lives in
// the Hub sidebar like any other destination. The Home card stays too — it is genuinely
// useful first thing in the morning.

export const dynamic = 'force-dynamic'

export default async function AmberNotesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Same gate as the sidebar entry and the API: a note here can stop the company taking
  // bookings or re-point the phone. Deep-linking straight to the URL must not bypass it.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_ai')
    .eq('id', user.id)
    .single()
  const row = profile as { role?: string; can_admin_ai?: boolean } | null
  if (!(row?.role === 'admin' || row?.can_admin_ai === true)) redirect('/hub')

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Amber — Right Now</h1>
          <p className="text-sm text-gray-400 mt-1">
            Temporary instructions for the AI receptionist. These override her knowledge base
            until they expire.
          </p>
        </div>
        <AmberNotesCard variant="page" />
      </div>
    </div>
  )
}
