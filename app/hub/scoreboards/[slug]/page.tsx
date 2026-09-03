import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getScoreboard, canSeeBoard, isCustomBoardSlug } from '@/lib/scoreboards/registry'
import { getGrantedBoardSlugs } from '@/lib/scoreboards/access'
import { resolveCustomBoard } from '@/lib/scoreboards/custom'
import { getBusinessProfile } from '@/lib/business-profile'
import Scoreboard7View from './Scoreboard7View'
import { createAdminClient } from '@/lib/supabase/admin'
import WidgetBoardView from '@/components/hub/scoreboards/widgets/WidgetBoardView'

export const metadata = { title: 'Scoreboard' }
export const dynamic = 'force-dynamic'

export default async function ScoreboardPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  // Call Coaching moved to Reports. Redirect rather than 404 so saved links, open
  // Workspace tabs and muscle memory all land somewhere useful. The destination
  // re-checks can_access_coaching, so this leaks nothing to someone without it.
  if (slug === '6') redirect('/hub/reports/coaching')

  /* Main (1), WF (2), IR (3), PW (4), Office (5) and Lead Sources (8) were retired
   * on Sep 3 2026 — their cards all exist in the widget library, so a board of
   * exactly the ones you want is a better answer than six we chose for you. Send
   * their old links to the index rather than 404ing: bookmarks, open Workspace tabs
   * and the odd Hub message all point at these. */
  if (['1', '2', '3', '4', '5', '8'].includes(slug)) redirect('/hub/scoreboards')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_access_scoreboards, company_id')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'
  const admin = createAdminClient()
  const { businessName } = await getBusinessProfile(admin, profile?.company_id ?? null)

  /* A board somebody built. Its own share list decides who may open it — see
   * lib/scoreboards/custom.ts — and that is the WHOLE test: being shared a board
   * is the grant, so the cards render with numbers whatever reports the viewer
   * holds, and no `can_access_scoreboards` flag is needed either. Sharing is one
   * step, which was the ask (Ben, Aug 20 2026).
   *
   * ⚠ What keeps this from being a side door is on the other side of the share:
   * a non-admin can only put a card on a board if their OWN report grants cover it
   * (the save-side gate in the widgets route), and a viewer cannot edit the board
   * at all — PUT 403s a non-manager — so they cannot re-point a person filter at
   * somebody else. You may pass on a view of what you can already read. */
  if (isCustomBoardSlug(slug)) {
    if (!profile?.company_id) redirect('/hub')
    const board = await resolveCustomBoard(profile.company_id, slug, user.id, !!isAdmin)
    // Not-shared and not-found land in the same place on purpose: probing slugs
    // shouldn't tell you which ones exist.
    if (!board.ok) redirect('/hub/scoreboards')
    return (
      <WidgetBoardView
        meta={{ slug, title: board.row.title, badge: 'Custom' }}
        businessName={businessName}
      />
    )
  }

  const board = getScoreboard(slug)
  if (!board) notFound()

  const perms = {
    isAdmin,
    canAccessScoreboards: !!profile?.can_access_scoreboards,
    allowedBoardSlugs: isAdmin ? [] : await getGrantedBoardSlugs(supabase, user.id),
  }
  // Section gate + per-board view grant (Admin -> Scoreboards). Admins see all.
  // The coaching exception that used to live here left with the board itself.
  if (!canSeeBoard(perms, board.slug)) redirect('/hub')

  /* Retention & Churn is the last hardcoded board, and stays hardcoded: its
   * weekly snapshots are the point of it, and only this view can read one. */
  if (board.slug === '7') {
    return <Scoreboard7View meta={board} businessName={businessName} />
  }
  notFound()
}
