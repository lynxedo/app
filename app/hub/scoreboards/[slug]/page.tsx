import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getScoreboard, canSeeBoard } from '@/lib/scoreboards/registry'
import { getGrantedBoardSlugs } from '@/lib/scoreboards/access'
import Scoreboard1View from './Scoreboard1View'
import Scoreboard2View from './Scoreboard2View'
import Scoreboard3View from './Scoreboard3View'
import Scoreboard4View from './Scoreboard4View'
import Scoreboard5View from './Scoreboard5View'
import Scoreboard6View from './Scoreboard6View'
import Scoreboard7View from './Scoreboard7View'
import Scoreboard8View from './Scoreboard8View'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata = { title: 'Scoreboard' }
export const dynamic = 'force-dynamic'

export default async function ScoreboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const board = getScoreboard(slug)
  if (!board) notFound()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_access_scoreboards')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'
  const admin = createAdminClient()
  const { data: coach } = await admin
    .from('user_profiles').select('can_access_coaching').eq('id', user.id).single()
  const perms = {
    isAdmin,
    canAccessScoreboards: !!profile?.can_access_scoreboards,
    canAccessCoaching: coach?.can_access_coaching === true,
    allowedBoardSlugs: isAdmin ? [] : await getGrantedBoardSlugs(supabase, user.id),
  }
  // Section gate + per-board view grant (Admin -> Scoreboards). Admins see all,
  // EXCEPT the coaching board, which is gated on can_access_coaching alone.
  if (!canSeeBoard(perms, board.slug)) redirect('/hub')

  switch (board.slug) {
    case '1':
      return <Scoreboard1View meta={board} />
    case '2':
      return <Scoreboard2View meta={board} />
    case '3':
      return <Scoreboard3View meta={board} />
    case '4':
      return <Scoreboard4View meta={board} />
    case '5':
      return <Scoreboard5View meta={board} />
    case '6':
      return <Scoreboard6View meta={board} />
    case '7':
      return <Scoreboard7View meta={board} />
    case '8':
      return <Scoreboard8View meta={board} />
    default:
      notFound()
  }
}
