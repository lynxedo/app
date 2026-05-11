import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isJobberConnected } from '@/lib/jobber'
import LogoutButton from '@/app/dashboard/LogoutButton'
import RouteBuilder from '@/app/dashboard/RouteBuilder'

interface Props {
  searchParams: Promise<{ jobber?: string; error?: string }>
}

export default async function RoutingPage({ searchParams }: Props) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const jobberConnected = await isJobberConnected(user.id)
  const params = await searchParams
  const justConnected = params.jobber === 'connected'
  const connectError = params.error

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-gray-400 hover:text-white text-sm transition-colors">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-bold tracking-tight">⚡ Route Optimizer</h1>
        </div>
        <div className="flex items-center gap-4">
          {jobberConnected && (
            <span className="text-xs text-green-400 font-medium">● Jobber Connected</span>
          )}
          <span className="text-sm text-gray-400">{user.email}</span>
          <Link href="/help" className="text-gray-400 hover:text-white transition-colors text-lg leading-none font-bold" title="Help">
            ?
          </Link>
          <Link href="/settings" aria-label="Settings" className="text-gray-400 hover:text-white transition-colors" title="Settings">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
          <LogoutButton />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        {justConnected && (
          <div className="mb-6 bg-green-900/40 border border-green-700 text-green-300 rounded-lg px-4 py-3 text-sm">
            Jobber connected successfully ✓
          </div>
        )}
        {connectError && (
          <div className="mb-6 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
            {connectError === 'jobber_denied' && 'Jobber authorization was cancelled.'}
            {connectError === 'invalid_state' && 'Security check failed — please try again.'}
            {connectError === 'token_exchange_failed' && 'Could not get tokens from Jobber. Try again.'}
            {connectError === 'db_error' && 'Could not save connection. Try again.'}
            {!['jobber_denied','invalid_state','token_exchange_failed','db_error'].includes(connectError)
              && `Error: ${connectError}`}
          </div>
        )}

        {!jobberConnected && (
          <div className="text-center py-16">
            <h2 className="text-3xl font-bold mb-3">Connect Jobber</h2>
            <p className="text-gray-400 mb-8">Connect your Jobber account to load visits and optimize routes.</p>
            <a
              href="/api/auth/jobber"
              className="inline-block px-6 py-3 bg-orange-500 hover:bg-orange-400 text-white rounded-xl text-sm font-medium transition-colors"
            >
              Connect Jobber →
            </a>
          </div>
        )}

        {jobberConnected && <RouteBuilder />}
      </main>
    </div>
  )
}
