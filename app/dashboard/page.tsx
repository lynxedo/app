import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isJobberConnected } from '@/lib/jobber'
import LogoutButton from './LogoutButton'
import RouteBuilder from './RouteBuilder'

interface Props {
  searchParams: Promise<{ jobber?: string; error?: string }>
}

export default async function DashboardPage({ searchParams }: Props) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const jobberConnected = await isJobberConnected(user.id)
  const params = await searchParams
  const justConnected = params.jobber === 'connected'
  const connectError = params.error

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Lynxedo</h1>
        <div className="flex items-center gap-4">
          {jobberConnected && (
            <span className="text-xs text-green-400 font-medium">● Jobber Connected</span>
          )}
          <span className="text-sm text-gray-400">{user.email}</span>
          <LogoutButton />
        </div>
      </header>

      {/* Main */}
      <main className="max-w-3xl mx-auto px-6 py-10">

        {/* Status banners */}
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

        {/* Not connected — prompt to connect */}
        {!jobberConnected && (
          <div className="text-center py-16">
            <h2 className="text-3xl font-bold mb-3">You&apos;re in 🎉</h2>
            <p className="text-gray-400 mb-8">Connect your Jobber account to get started.</p>
            <a
              href="/api/auth/jobber"
              className="inline-block px-6 py-3 bg-orange-500 hover:bg-orange-400 text-white rounded-xl text-sm font-medium transition-colors"
            >
              Connect Jobber →
            </a>
          </div>
        )}

        {/* Connected — show route builder */}
        {jobberConnected && <RouteBuilder />}

      </main>
    </div>
  )
}
