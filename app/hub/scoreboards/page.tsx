import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { boardsForUser } from '@/lib/scoreboards/registry'

export const metadata = { title: 'Scoreboards' }
export const dynamic = 'force-dynamic'

export default async function ScoreboardsIndexPage() {
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
  const boards = boardsForUser(perms)
  if (boards.length === 0) redirect('/hub')

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <header className="px-4 md:px-6 pt-4 pb-2 max-md:pl-14">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Scoreboards</h1>
        <p className="text-sm text-gray-400 mt-1">Live KPI dashboards</p>
      </header>
      <main className="max-w-3xl mx-auto px-4 md:px-6 py-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {boards.map(b => (
            <Link
              key={b.slug}
              href={`/hub/scoreboards/${b.slug}`}
              className="group rounded-xl border border-sky-400/15 bg-gradient-to-br from-[#0f2e47] to-[#1a3d5c] p-5 transition hover:border-sky-400/40"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">📊</span>
                <span className="text-base font-semibold text-sky-50">{b.title}</span>
              </div>
              <p className="mt-2 text-sm text-slate-400">{b.subtitle}</p>
              <span className="mt-4 inline-block text-xs font-medium text-sky-300 group-hover:translate-x-0.5 transition-transform">
                Open →
              </span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
