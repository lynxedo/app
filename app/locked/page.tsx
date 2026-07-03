import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SignOutButton from './SignOutButton'

export const metadata = { title: 'Account locked' }

export default async function LockedPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('locked_at, deactivated_at')
    .eq('id', user.id)
    .single()
  if (!profile?.locked_at && !profile?.deactivated_at) redirect('/hub')

  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center px-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 max-w-sm w-full text-center space-y-4">
        <div className="text-4xl">🔒</div>
        <h1 className="text-lg font-semibold">Account locked</h1>
        <p className="text-sm text-gray-400">
          Your Lynxedo account has been locked by an administrator. If you think
          this is a mistake, contact your manager.
        </p>
        <SignOutButton />
      </div>
    </div>
  )
}
