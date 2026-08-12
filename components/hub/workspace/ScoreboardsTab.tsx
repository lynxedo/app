'use client'

/**
 * Workspace-tab twins for Scoreboards. A Scoreboards tab is per-instance:
 *  - no instanceKey → the INDEX grid (ScoreboardsIndexTab); its cards open
 *    individual boards as their own slug-keyed tabs.
 *  - instanceKey = slug → one board (ScoreboardBoardTab), rendering whatever the
 *    real /hub/scoreboards/[slug] route renders: WidgetBoardView for a board
 *    migrated to widgets, otherwise its hardcoded Scoreboard{N}View.
 *
 * ⚠ This twin is a SECOND entry point that never touches the route's page.tsx, so
 * any board-level dispatch has to be mirrored in both. The widget migration was
 * shipped without it once and Board 8 kept showing its old view for anyone with
 * Workspace Tabs on — the route was right and the tab was stale.
 *
 * The board views already self-fetch their KPI payload (useScoreboardData), and
 * the registry (`getScoreboard`) is pure/client-safe, so a twin only needs the
 * slug. `businessName` is omitted → the views' built-in default renders (correct
 * for the current tenant; a multi-tenant refinement can pass it later).
 */

import { SCOREBOARDS, getScoreboard } from '@/lib/scoreboards/registry'
import { hasWidgetLayout } from '@/lib/scoreboards/widgets/registry'
import WidgetBoardView from '@/components/hub/scoreboards/widgets/WidgetBoardView'
import { useWorkspaceTabs } from './WorkspaceTabsContext'
import Scoreboard1View from '@/app/hub/scoreboards/[slug]/Scoreboard1View'
import Scoreboard2View from '@/app/hub/scoreboards/[slug]/Scoreboard2View'
import Scoreboard3View from '@/app/hub/scoreboards/[slug]/Scoreboard3View'
import Scoreboard4View from '@/app/hub/scoreboards/[slug]/Scoreboard4View'
import Scoreboard5View from '@/app/hub/scoreboards/[slug]/Scoreboard5View'
import Scoreboard7View from '@/app/hub/scoreboards/[slug]/Scoreboard7View'
import Scoreboard8View from '@/app/hub/scoreboards/[slug]/Scoreboard8View'

export function ScoreboardsIndexTab({ allowedSlugs, isAdmin }: { allowedSlugs: string[]; isAdmin: boolean }) {
  const tabs = useWorkspaceTabs()
  // Mirror the sidebar's visibility: admins see all, others see their grants.
  const boards = isAdmin ? SCOREBOARDS : SCOREBOARDS.filter(b => (allowedSlugs ?? []).includes(b.slug))

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6">
      <h1 className="text-xl font-semibold mb-1">Scoreboards</h1>
      <p className="text-sm text-white/50 mb-5">Open a board — it stays put in its own tab.</p>
      {boards.length === 0 ? (
        <p className="text-sm text-white/50">No scoreboards available to you yet.</p>
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
          {boards.map(b => (
            <button
              key={b.slug}
              type="button"
              onClick={() => tabs.openTab({ catalogId: 'scoreboards', instanceKey: b.slug, label: b.title, href: `/hub/scoreboards/${b.slug}` })}
              className="text-left rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/20 p-4 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                {b.badge && <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold bg-white/10 text-white/70">{b.badge}</span>}
                <span className="font-semibold truncate">{b.title}</span>
              </div>
              <p className="text-[13px] text-white/55 line-clamp-2">{b.subtitle}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ScoreboardBoardTab({ slug }: { slug: string }) {
  const meta = getScoreboard(slug)
  if (!meta) return <div className="p-6 text-sm text-white/60">Unknown scoreboard.</div>

  // A board migrated to widgets renders from its saved layout HERE TOO. This twin
  // bypasses app/hub/scoreboards/[slug]/page.tsx entirely, so a board added to the
  // widget list without this line keeps showing its old hardcoded view for anyone
  // using Workspace Tabs — and looks like the migration simply didn't ship.
  if (hasWidgetLayout(slug)) {
    return <WidgetBoardView meta={meta} classicHref={`/hub/scoreboards/${slug}?classic=1`} />
  }

  // Same slug→view dispatch as app/hub/scoreboards/[slug]/page.tsx. ⚠ This is a
  // SECOND entry point: a change to the dispatch there must land here too, and
  // tsc cannot catch a stale one because both components stay valid. Board 6
  // (Call Coaching) moved to /hub/reports/coaching and is deliberately absent.
  switch (slug) {
    case '1': return <Scoreboard1View meta={meta} />
    case '2': return <Scoreboard2View meta={meta} />
    case '3': return <Scoreboard3View meta={meta} />
    case '4': return <Scoreboard4View meta={meta} />
    case '5': return <Scoreboard5View meta={meta} />
    case '7': return <Scoreboard7View meta={meta} />
    case '8': return <Scoreboard8View meta={meta} />
    default:  return <div className="p-6 text-sm text-white/60">Unknown scoreboard.</div>
  }
}
