import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import LogoutButton from './LogoutButton'

export const metadata = { title: 'Dashboard' }

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
        <svg viewBox="0 0 211.66656 34.395823" style={{height:'70px',width:'auto'}} xmlns="http://www.w3.org/2000/svg" aria-label="Lynxedo">
          <g transform="translate(-6.38091,-44.499305)">
            <path fill="#ffffff" d="m 344.54608,125.93317 c 0.46202,0 0.54866,-0.27432 0.54866,-0.7941 0,-0.50534 -0.0866,-0.76523 -0.54866,-0.76523 h -7.07481 c -1.6893,0 -2.41123,-0.50532 -2.41123,-1.12618 v -7.16145 c 0,-0.54865 -0.33207,-0.67859 -0.96736,-0.67859 -0.62085,0 -0.95293,0.12994 -0.95293,0.67859 v 7.16143 c 0,1.79037 1.4294,2.68553 4.27376,2.68553 z m 5.7564,-4.33149 v 3.71063 c 0,0.54869 0.33207,0.67863 0.95294,0.67863 0.63528,0 0.96735,-0.12994 0.96735,-0.67863 v -3.71063 l 5.21226,-5.039 c 0.1877,-0.17326 0.30321,-0.38984 0.30321,-0.57754 0,-0.31763 -0.31763,-0.57752 -1.03956,-0.57752 -0.41871,0 -0.62085,0.0866 -0.80855,0.27431 l -4.62029,4.5048 -4.63473,-4.5048 c -0.20213,-0.18769 -0.38983,-0.27431 -0.80854,-0.27431 -0.73635,0 -1.03956,0.27431 -1.03956,0.57752 0,0.1877 0.11544,0.40428 0.30321,0.57754 z m 23.63114,4.38926 c 0.66416,0 0.99625,-0.11545 0.99625,-0.67863 v -9.2261 c 0,-0.54865 -0.33209,-0.67859 -0.96737,-0.67859 -0.62086,0 -0.95294,0.12994 -0.95294,0.67859 v 7.39245 l -8.85074,-7.53684 c -0.44759,-0.37539 -0.72191,-0.5342 -1.35721,-0.5342 -0.59197,0 -0.90962,0.14443 -0.90962,0.67859 v 9.2261 c 0,0.54869 0.3321,0.67863 0.95294,0.67863 0.63529,0 0.96737,-0.12994 0.96737,-0.67863 v -7.37797 l 8.98069,7.56569 c 0.50534,0.41871 0.62086,0.49091 1.14063,0.49091 z" transform="matrix(1.2017156,0,0,1.2017156,-356.23191,-83.348993)"/>
            <path fill="#ffffff" d="m 409.34822,121.55839 c 0.46202,0 0.5631,-0.2599 0.5631,-0.77968 0,-0.51978 -0.10113,-0.77968 -0.5631,-0.77968 h -7.56572 v -1.8481 c 0,-0.6353 0.73635,-1.1262 2.42565,-1.1262 h 6.95931 c 0.44759,0 0.54865,-0.25989 0.54865,-0.77969 0,-0.51978 -0.10112,-0.77967 -0.54865,-0.77967 h -7.01707 c -2.84436,0 -4.27376,0.88075 -4.27376,2.68556 v 5.09674 c 0,1.79036 1.4294,2.68553 4.27376,2.68553 h 6.95931 c 0.46202,0 0.60641,-0.30572 0.60641,-0.81104 0,-0.51976 -0.14444,-0.74829 -0.60641,-0.74829 h -6.90155 c -1.6893,0 -2.42565,-0.50532 -2.42565,-1.12617 v -1.6893 z m 19.97824,-3.40746 c 0,-1.80481 -1.41498,-2.68556 -4.27378,-2.68556 h -8.18656 c -0.4476,0 -0.66418,0.21658 -0.66418,0.66417 v 9.12506 c 0,0.44758 0.21658,0.6786 0.66418,0.6786 h 8.18656 c 2.8588,0 4.27378,-0.89517 4.27378,-2.68553 z m -11.20421,-1.1262 h 6.87267 c 1.6893,0 2.4401,0.4909 2.4401,1.1262 v 5.09674 c 0,0.62086 -0.7508,1.1262 -2.4401,1.1262 h -6.87267 z m 24.09316,8.90847 c 2.84438,0 4.27377,-0.89517 4.27377,-2.68553 v -5.09672 c 0,-1.80481 -1.42939,-2.68556 -4.27377,-2.68556 h -4.20157 c -2.84435,0 -4.27376,0.88075 -4.27376,2.68556 v 5.09672 c 0,1.79037 1.42941,2.68553 4.27376,2.68553 z m -0.0578,-1.55933 h -4.08607 c -1.68929,0 -2.42565,-0.50534 -2.42565,-1.1262 v -5.09672 c 0,-0.63531 0.73636,-1.1262 2.42565,-1.1262 h 4.08607 c 1.68929,0 2.42565,0.49089 2.42565,1.1262 v 5.09672 c 0,0.62086 -0.73636,1.1262 -2.42565,1.1262 z" transform="matrix(1.2017156,0,0,1.2017156,-356.23191,-83.348993)"/>
          </g>
          <g transform="translate(-279.06672,-103.50137)">
            <path fill="#ffffff" d="m 360.71791,144.83954 c -1.45041,-0.26243 -2.67307,-0.90705 -3.73032,-1.96674 -0.38046,-0.38135 -0.832,-0.92553 -1.00338,-1.20931 -1.16141,-1.92298 -1.40047,-4.40211 -0.6235,-6.46634 0.43461,-1.15465 0.88685,-1.73027 3.25899,-4.14808 1.23283,-1.25659 4.36426,-4.47109 6.95876,-7.14336 5.15701,-5.31162 6.89058,-7.0515 7.0258,-7.0515 0.0821,0 2.39546,2.26895 2.64928,2.59832 0.1014,0.13143 -0.24538,0.52036 -3.18075,3.56875 -1.81191,1.8817 -5.38534,5.54223 -7.94097,8.13449 -5.36017,5.43706 -5.15995,5.18288 -5.16154,6.55199 -8.8e-4,0.75427 0.0271,0.92037 0.22949,1.35166 0.30485,0.65072 0.92493,1.29951 1.52169,1.59259 0.43028,0.2113 0.57864,0.23753 1.34362,0.23753 0.71727,0 0.92486,-0.0318 1.25124,-0.19285 0.2812,-0.13867 1.63394,-1.43758 4.81319,-4.62219 2.43207,-2.43613 4.46724,-4.42932 4.52263,-4.42932 0.11999,0 2.69903,2.64273 2.69903,2.76579 0,0.0871 -2.96338,3.12293 -6.87693,7.04489 -1.51895,1.52224 -2.3579,2.2973 -2.72264,2.51532 -1.46002,0.87266 -3.27734,1.18617 -5.03366,0.86836 z m 17.40117,-15.92472 -1.292,-1.3544 0.65952,-0.68795 c 2.45937,-2.56536 9.91647,-10.21659 12.36235,-12.68412 3.12322,-3.15089 3.28453,-3.35212 3.4635,-4.32009 0.15682,-0.84846 -0.1406,-1.93656 -0.7348,-2.68797 -0.30485,-0.38538 -0.98415,-0.85714 -1.48961,-1.03433 -0.56993,-0.19981 -1.49572,-0.17622 -2.11234,0.0539 -0.47185,0.17598 -0.66,0.34397 -2.48597,2.21912 -3.95555,4.06218 -6.79214,6.88739 -6.91509,6.88739 -0.11221,0 -2.58993,-2.49367 -2.66152,-2.67854 -0.0169,-0.041 1.18657,-1.32227 2.67209,-2.84723 1.48554,-1.52496 3.47103,-3.57605 4.41222,-4.55799 2.14283,-2.23564 2.63367,-2.5961 4.12238,-3.02751 2.46748,-0.71504 5.07359,-0.0477 6.99403,1.79099 0.96729,0.92609 1.59474,1.9496 2.03701,3.32284 0.45623,1.41656 0.3831,3.4656 -0.17237,4.83292 -0.48164,1.18529 -0.67091,1.39984 -5.33323,6.04533 -2.46832,2.45942 -6.16715,6.18516 -8.2196,8.27941 -2.05241,2.09426 -3.79531,3.80661 -3.87305,3.80524 -0.0777,-0.001 -0.72276,-0.61198 -1.43338,-1.35689 z" transform="matrix(0.59089933,0,0,0.59089933,159.7636,47.760246)"/>
            <path fill="#ff8624" d="m 359.26204,59.08198 c -1.63585,0.07448 -3.04797,0.677095 -4.24024,1.809663 -1.47159,1.397853 -2.24106,3.144401 -2.23317,5.070877 0.006,1.42577 0.46161,2.79485 1.29293,3.882817 0.19792,0.258876 2.14506,2.252594 4.32739,4.430198 l 3.96792,3.959074 1.29358,-1.290875 c 0.71121,-0.710236 1.2929,-1.32676 1.2929,-1.369842 0,-0.0431 -1.79872,-1.878702 -3.99718,-4.079573 -4.44035,-4.445244 -4.37268,-4.362454 -4.45607,-5.471209 -0.0977,-1.298922 0.79247,-2.638729 2.07042,-3.116871 0.79238,-0.296457 1.79487,-0.202982 2.50003,0.232856 0.13904,0.08592 2.34817,2.318594 4.90884,4.96126 5.3638,5.535568 9.79604,10.021236 9.90209,10.021236 0.0404,0 0.61216,-0.556209 1.27114,-1.235724 0.65895,-0.679499 1.22282,-1.259015 1.25273,-1.288134 0.0308,-0.02898 -0.8898,-1.01745 -2.04388,-2.196377 -1.15404,-1.178926 -3.14261,-3.236859 -4.4193,-4.573186 -4.0473,-4.236355 -8.14591,-8.331599 -8.72221,-8.714715 -1.04602,-0.695389 -1.91612,-0.971388 -3.25305,-1.031466 -0.24293,-0.01079 -0.48118,-0.01079 -0.71487,0 z m 9.5433,20.259657 -0.86807,0.860577 c -0.47709,0.473315 -1.04577,1.065465 -1.26432,1.315379 l -0.39761,0.454116 2.0711,2.094944 c 1.13909,1.152247 4.01681,4.089585 6.39442,6.527184 5.46988,5.607914 6.19925,6.320114 6.89143,6.728023 0.69388,0.408915 1.78365,0.774994 2.59129,0.870119 2.88485,0.339782 5.51156,-0.993977 6.74709,-3.425974 1.07237,-2.110914 0.88641,-4.919637 -0.44802,-6.770923 -0.28147,-0.390651 -1.34395,-1.518076 -3.428,-3.637709 -0.72111,-0.733439 -2.11134,-2.155786 -3.08962,-3.16113 l -1.77905,-1.828046 -0.35948,0.331563 c -0.19761,0.182172 -0.78069,0.779434 -1.29632,1.327633 l -0.93749,0.996754 1.97713,2.029567 c 1.08751,1.116281 2.86607,2.929726 3.95229,4.029877 1.14365,1.158387 2.0419,2.134088 2.13439,2.318246 0.27839,0.554325 0.37171,1.203485 0.26082,1.80558 -0.12024,0.652336 -0.31791,1.047861 -0.76047,1.52099 -0.43057,0.460308 -1.03588,0.770262 -1.70756,0.874873 -0.63814,0.09933 -1.18185,0.0013 -1.84913,-0.331563 -0.5019,-0.250799 -1.49163,-1.241217 -10.33716,-10.345326 -2.07495,-2.135599 -3.93604,-4.041246 -4.13542,-4.234113 z" transform="matrix(0.64778274,0,0,0.64778274,140.9259,69.760598)"/>
          </g>
        </svg>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">{user.email}</span>
          {isAdmin && (
            <Link href="/admin" className="text-gray-400 hover:text-white transition-colors" title="Admin" aria-label="Admin">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.249-8.25-3.285z" />
              </svg>
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
              href="/hub/lawn"
              className="group bg-gray-900 border border-gray-800 hover:border-green-500 rounded-2xl p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-green-500/10 block"
            >
              <div className="flex items-start justify-between mb-4">
                <span className="text-3xl">🌿</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/25">Live</span>
              </div>
              <div className="font-bold text-lg mb-1">Lawn Sizer</div>
              <div className="text-gray-400 text-sm leading-relaxed">
                Calculate lawn size, estimate service time, and generate quotes based on county data.
              </div>
              <div className="mt-5 text-green-400 text-sm font-medium group-hover:text-green-300 transition-colors">Open →</div>
            </Link>
          )}

          {profile?.can_access_call_log && (
            <Link
              href="/hub/call-log"
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
              href="/hub/tracker"
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
