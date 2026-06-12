import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getScoreboard, canSeeScoreboards } from '@/lib/scoreboards/registry'
import Scoreboard1View from './Scoreboard1View'
import Scoreboard2View from './Scoreboard2View'

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

  const perms = {
    isAdmin: profile?.role === 'admin',
    canAccessScoreboards: !!profile?.can_access_scoreboards,
  }
  // Section gate now; per-board gate (board.requiredFlag) honored for the future.
  if (!canSeeScoreboards(perms)) redirect('/hub')
  if (board.requiredFlag && !perms[board.requiredFlag]) redirect('/hub')

  switch (board.slug) {
    case '1':
      return <Scoreboard1View meta={board} />
    case '2':
      return <Scoreboard2View meta={board} />
    default:
      notFound()
  }
}
