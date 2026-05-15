import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import LogoutButton from './LogoutButton'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_access_routing, can_access_lawn, can_access_call_log, can_access_responder, can_access_timesheet, can_access_books, can_access_tracker, can_access_hub')
    .eq('id', user.id)
    .single()

  const name = user.email?.split('@')[0] ?? 'there'
  const isAdmin = profile?.role === 'admin'

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <span className="text-xl font-bold tracking-tight">Lynxedo</span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">{user.email}</span>
          {isAdmin && (
            <Link href="/admin" className="text-gray-400 hover:text-white transition-colors text-sm" title="User Management">
              👥
            </Link>
          )}
          <Link href="/help" className="text-gray-400 hover:text-white transition-colors text-lg leading-none font-bold" title="Help">
            ?
          </Link>
          <Link href="/settings" className="text-gray-400 hover:text-white transition-colors text-lg leading-none" title="Settings">
            ⚙
          </Link>
          <LogoutButton />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h2 className="text-2xl font-bold">Good to see you, {name}</h2>
          <p className="text-gray-400 text-sm mt-1">What are you working on today?</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

          {profile?.can_access_routing && (
            <Link
              href="/routing"
              className="group bg-gray-900 border border-gray-800 hover:border-blue-500 rounded-2xl p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-500/10 block"
            >
              <div className="flex items-start justify-between mb-4">
                <span className="text-3xl">⚡</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/25">Live</span>
              </div>
              <div className="font-bold text-lg mb-1">Route Optimizer</div>
              <div className="text-gray-400 text-sm leading-relaxed">
                Load visits, optimize stop order with real road times, send schedule to Jobber.
              </div>
              <div className="mt-5 text-blue-400 text-sm font-medium group-hover:text-blue-300 transition-colors">Open →</div>
            </Link>
          )}

          {profile?.can_access_lawn && (
            <Link
              href="/lawn"
              className="group bg-gray-900 border border-gray-800 hover:border-green-500 rounded-2xl p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-green-500/10 block"
            >
              <div className="flex items-start justify-between mb-4">
                <span className="text-3xl">🌿</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/25">Live</span>
              </div>
              <div className="font-bold text-lg mb-1">Lawn Calculator</div>
              <div className="text-gray-400 text-sm leading-relaxed">
                Calculate lawn size, estimate service time, and generate quotes based on county data.
              </div>
              <div className="mt-5 text-green-400 text-sm font-medium group-hover:text-green-300 transition-colors">Open →</div>
            </Link>
          )}

          {profile?.can_access_call_log && (
            <Link
              href="/call-log"
              className="group bg-gray-900 border border-gray-800 hover:border-purple-500 rounded-2xl p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-purple-500/10 block"
            >
              <div className="flex items-start justify-between mb-4">
                <span className="text-3xl">📋</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/25">Live</span>
              </div>
              <div className="font-bold text-lg mb-1">Call Log</div>
              <div className="text-gray-400 text-sm leading-relaxed">
                Browse, search, and listen to call recordings with AI summaries and transcripts.
              </div>
              <div className="mt-5 text-purple-400 text-sm font-medium group-hover:text-purple-300 transition-colors">Open →</div>
            </Link>
          )}

          {profile?.can_access_timesheet && (
            <Link
              href="/timesheet"
              className="group bg-gray-900 border border-gray-800 hover:border-yellow-500 rounded-2xl p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-yellow-500/10 block"
            >
              <div className="flex items-start justify-between mb-4">
                <span className="text-3xl">🕐</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/25">Live</span>
              </div>
              <div className="font-bold text-lg mb-1">Timesheet</div>
              <div className="text-gray-400 text-sm leading-relaxed">
                Clock in and out, track hours, view your pay period summary and overtime.
              </div>
              <div className="mt-5 text-yellow-400 text-sm font-medium group-hover:text-yellow-300 transition-colors">Open →</div>
            </Link>
          )}

          {profile?.can_access_responder && (
            <Link
              href="/responder"
              className="group bg-gray-900 border border-gray-800 hover:border-orange-500 rounded-2xl p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-orange-500/10 block"
            >
              <div className="flex items-start justify-between mb-4">
                <span className="text-3xl">📞</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/25">Live</span>
              </div>
              <div className="font-bold text-lg mb-1">Responder</div>
              <div className="text-gray-400 text-sm leading-relaxed">
                Auto-texts missed calls, handles replies with AI, and routes leads to the right person.
              </div>
              <div className="mt-5 text-orange-400 text-sm font-medium group-hover:text-orange-300 transition-colors">Open →</div>
            </Link>
          )}

          {profile?.can_access_books && (
            <Link
              href="/books"
              className="group bg-gray-900 border border-gray-800 hover:border-emerald-500 rounded-2xl p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-500/10 block"
            >
              <div className="flex items-start justify-between mb-4">
                <span className="text-3xl">📊</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/25">Live</span>
              </div>
              <div className="font-bold text-lg mb-1">Books</div>
              <div className="text-gray-400 text-sm leading-relaxed">
                Live P&amp;L, revenue trends, cost breakdown, and overhead from QuickBooks.
              </div>
              <div className="mt-5 text-emerald-400 text-sm font-medium group-hover:text-emerald-300 transition-colors">Open →</div>
            </Link>
          )}

          {profile?.can_access_tracker && (
            <Link
              href="/tracker"
              className="group bg-gray-900 border border-gray-800 hover:border-indigo-500 rounded-2xl p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/10 block"
            >
              <div className="flex items-start justify-between mb-4">
                <span className="text-3xl">🎯</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/25">Live</span>
              </div>
              <div className="font-bold text-lg mb-1">Tracker</div>
              <div className="text-gray-400 text-sm leading-relaxed">
                Sales pipeline, lead tracking, close rates, and revenue by salesperson.
              </div>
              <div className="mt-5 text-indigo-400 text-sm font-medium group-hover:text-indigo-300 transition-colors">Open →</div>
            </Link>
          )}

          {profile?.can_access_hub && (
            <Link
              href="/hub"
              className="group bg-gray-900 border border-gray-800 hover:border-sky-500 rounded-2xl p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-sky-500/10 block"
            >
              <div className="flex items-start justify-between mb-4">
                <span className="text-3xl">💬</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/25">Live</span>
              </div>
              <div className="font-bold text-lg mb-1">Hub</div>
              <div className="text-gray-400 text-sm leading-relaxed">
                Team messaging — rooms, direct messages, and real-time updates in one place.
              </div>
              <div className="mt-5 text-sky-400 text-sm font-medium group-hover:text-sky-300 transition-colors">Open →</div>
            </Link>
          )}

        </div>

        <p className="text-center text-gray-700 text-xs mt-10">
          <a href="/privacy" className="hover:text-gray-500 transition-colors">Privacy Policy</a>
        </p>
      </main>
    </div>
  )
}
