import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AdminTabNav from '@/components/AdminTabNav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/hub" className="text-gray-400 hover:text-white text-sm transition-colors">
            ← Hub
          </Link>
          <span className="text-gray-600">|</span>
          <span className="text-xl font-bold tracking-tight">Admin</span>
        </div>
      </header>
      <div className="border-b border-gray-800 px-6">
        <AdminTabNav />
      </div>
      <main className="max-w-4xl mx-auto px-6 py-10">
        {children}
      </main>
    </div>
  )
}
