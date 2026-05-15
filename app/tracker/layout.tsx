import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import TrackerNav from './TrackerNav'

export default async function TrackerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-lg font-bold tracking-tight text-gray-300 hover:text-white transition-colors"
          >
            Lynxedo
          </Link>
          <span className="text-gray-600">/</span>
          <span className="font-medium text-white">Tracker</span>
        </div>
        <span className="text-sm text-gray-500">{user.email}</span>
      </header>
      <TrackerNav isAdmin={isAdmin} />
      {children}
    </div>
  )
}
