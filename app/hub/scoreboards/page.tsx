import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { boardsForUser } from '@/lib/scoreboards/registry'
import { getGrantedBoardSlugs } from '@/lib/scoreboards/access'
import { listCustomBoards } from '@/lib/scoreboards/custom'
import { createAdminClient } from '@/lib/supabase/admin'
import NewScoreboardButton from './NewScoreboardButton'

export const metadata = { title: 'Scoreboards' }
export const dynamic = 'force-dynamic'

export default async function ScoreboardsIndexPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_access_scoreboards, company_id')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'
  // Coaching board (slug '6') is gated on can_access_coaching alone (admins don't
  // bypass); read it via the admin client to avoid a generated-types dependency.
  const admin = createAdminClient()
  const { data: coach } = await admin
    .from('user_profiles').select('can_access_coaching').eq('id', user.id).single()
  const canAccessCoaching = coach?.can_access_coaching === true
  // Section-level access: admin, the can_access_scoreboards flag, or coaching.
  const hasSectionAccess = isAdmin || !!profile?.can_access_scoreboards || canAccessCoaching
  if (!hasSectionAccess) redirect('/hub')

  const perms = {
    isAdmin,
    canAccessScoreboards: !!profile?.can_access_scoreboards,
    canAccessCoaching,
    allowedBoardSlugs: isAdmin ? [] : await getGrantedBoardSlugs(supabase, user.id),
  }
  const boards = boardsForUser(perms)

  // Anyone who can open Scoreboards can build one. Coaching-only access is not
  // Scoreboards access, so it doesn't come with a build button.
  const canBuild = isAdmin || !!profile?.can_access_scoreboards
  const custom = canBuild && profile?.company_id
    ? await listCustomBoards(profile.company_id, user.id, !!isAdmin)
    : []
  // Split on AUTHORSHIP, not on canManage. An admin can manage every custom board in
  // the company, so grouping by canManage would file nine other people's boards under
  // "Your scoreboards" — a heading that would then be simply untrue.
  const mine = custom.filter(b => b.createdBy === user.id)
  const others = custom.filter(b => b.createdBy !== user.id)
  const othersHeading = isAdmin ? 'Everyone’s scoreboards' : 'Shared with you'

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <header className="px-4 md:px-6 pt-4 pb-2 max-md:pl-14">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Scoreboards</h1>
        <p className="text-sm text-gray-400 mt-1">Live KPI dashboards</p>
      </header>
      <main className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-8">
        {boards.length === 0 && custom.length === 0 ? (
          // Has the section flag but nothing assigned yet. Don't bounce them to
          // /hub (looks like a broken/blinking page) — explain, and offer the one
          // thing they CAN do, which is build their own.
          <div className="rounded-xl border border-sky-400/15 bg-[var(--t-panel)]/60 p-6 text-center">
            <div className="text-3xl">📊</div>
            <p className="mt-3 text-base font-semibold text-sky-50">No scoreboards assigned yet</p>
            <p className="mt-1 text-sm text-gray-400">
              You have access to the Scoreboards section, but no specific boards have been shared with you.
              Ask an admin to grant you a board in <span className="text-sky-300">Admin → Scoreboards → “Who can see each board.”</span>
            </p>
            {canBuild ? (
              <>
                <p className="mt-3 text-sm text-gray-400">Or build your own from the widget library.</p>
                <div className="mt-3 flex justify-center"><NewScoreboardButton /></div>
              </>
            ) : null}
          </div>
        ) : null}

        {boards.length > 0 ? (
          <section>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[1px] text-gray-500">Standard boards</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {boards.map(b => (
                <Link
                  key={b.slug}
                  href={`/hub/scoreboards/${b.slug}`}
                  className="group rounded-xl border border-sky-400/15 bg-gradient-to-br from-[var(--t-panel)] to-[var(--t-sidebar)] p-5 transition hover:border-sky-400/40"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">📊</span>
                    <span className="text-base font-semibold text-sky-50">{b.title}</span>
                  </div>
                  <p className="mt-2 text-sm text-gray-400">{b.subtitle}</p>
                  <span className="mt-4 inline-block text-xs font-medium text-sky-300 group-hover:translate-x-0.5 transition-transform">
                    Open →
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {canBuild ? (
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[1px] text-gray-500">Your scoreboards</h2>
              <NewScoreboardButton compact />
            </div>
            {mine.length === 0 ? (
              <p className="rounded-xl border border-dashed border-sky-400/20 bg-white/[0.02] p-5 text-sm text-gray-400">
                Build a board of exactly the cards you want, then pick who can see it. The library is the
                same one the preset Reports are built from — you’ll see the cards covered by the reports
                you have access to.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {mine.map(b => (
                  <Link
                    key={b.slug}
                    href={`/hub/scoreboards/${b.slug}`}
                    className="group rounded-xl border border-sky-400/15 bg-gradient-to-br from-[var(--t-panel)] to-[var(--t-sidebar)] p-5 transition hover:border-sky-400/40"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🧭</span>
                      <span className="text-base font-semibold text-sky-50">{b.title}</span>
                    </div>
                    <p className="mt-2 text-sm text-gray-400">
                      {b.widgetCount === 0 ? 'Empty — nothing added yet' : `${b.widgetCount} ${b.widgetCount === 1 ? 'card' : 'cards'}`}
                      {' · '}
                      {b.sharedAll
                        ? 'shared with everyone'
                        : b.sharedWithCount
                          ? `shared with ${b.sharedWithCount}`
                          : 'only you'}
                    </p>
                    <span className="mt-4 inline-block text-xs font-medium text-sky-300 group-hover:translate-x-0.5 transition-transform">
                      Open →
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {others.length > 0 ? (
          <section>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[1px] text-gray-500">{othersHeading}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {others.map(b => (
                <Link
                  key={b.slug}
                  href={`/hub/scoreboards/${b.slug}`}
                  className="group rounded-xl border border-sky-400/15 bg-gradient-to-br from-[var(--t-panel)] to-[var(--t-sidebar)] p-5 transition hover:border-sky-400/40"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🧭</span>
                    <span className="text-base font-semibold text-sky-50">{b.title}</span>
                  </div>
                  <p className="mt-2 text-sm text-gray-400">
                    {b.widgetCount === 0 ? 'Empty — nothing added yet' : `${b.widgetCount} ${b.widgetCount === 1 ? 'card' : 'cards'}`}
                  </p>
                  <span className="mt-4 inline-block text-xs font-medium text-sky-300 group-hover:translate-x-0.5 transition-transform">
                    Open →
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  )
}
