import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Social | Marketing' }

export default async function MarketingSocialPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_marketing')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_marketing) redirect('/hub')

  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="max-w-md">
        <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.952 9.168-5v10c-1.543-3.048-5.068-5-9.168-5H7a3.988 3.988 0 00-1.564.317z" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-white mb-2">Social posting coming soon</h1>
        <p className="text-white/50 text-sm">
          Schedule Facebook and Instagram posts directly from Hub Files photos.
          Check back soon.
        </p>
      </div>
    </div>
  )
}
