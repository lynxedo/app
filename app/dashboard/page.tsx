import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LogoutButton from './LogoutButton'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Lynxedo</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">{user.email}</span>
          <LogoutButton />
        </div>
      </header>

      {/* Main */}
      <main className="max-w-4xl mx-auto px-6 py-16 text-center">
        <h2 className="text-3xl font-bold mb-3">You're in 🎉</h2>
        <p className="text-gray-400 mb-8">
          Auth is working. Next up: connect your Jobber account.
        </p>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-left max-w-md mx-auto">
          <h3 className="font-semibold mb-4 text-lg">Quick Route</h3>
          <p className="text-gray-400 text-sm">
            Connect Jobber to pull today's visits, optimize the route, and push it back in one click.
          </p>
          <button
            disabled
            className="mt-6 w-full bg-gray-700 text-gray-400 rounded-lg py-2.5 text-sm cursor-not-allowed"
          >
            Connect Jobber — coming next
          </button>
        </div>
      </main>
    </div>
  )
}
