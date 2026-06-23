import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Marketing' }

// The Marketing roof. Each channel (Email, Social, and — later — Txt) is a
// card here and a row in MarketingSidebar; keep the two in sync.
type Channel = {
  id: string
  title: string
  description: string
  href: string
  icon: string
  available: boolean
}

export default async function HubMarketingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_marketing, can_access_email, role')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'
  const canSocial = isAdmin || !!profile?.can_access_marketing
  const canEmail = isAdmin || !!profile?.can_access_email
  if (!canSocial && !canEmail) redirect('/hub')

  const channels: Channel[] = []
  if (canEmail) {
    channels.push({
      id: 'email',
      title: 'Email',
      description: 'Campaigns, templates, segments, and drip automations.',
      href: '/hub/marketing/email',
      icon: '📧',
      available: true,
    })
  }
  if (canSocial) {
    channels.push({
      id: 'social',
      title: 'Social',
      description: 'Post to Facebook & Instagram from one place.',
      href: '/hub/marketing/social',
      icon: '📣',
      available: true,
    })
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Marketing</h1>
          <p className="text-sm text-gray-500 mt-1">Choose a channel to open.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {channels.map(ch => (
            <Link
              key={ch.id}
              href={ch.href}
              className="group flex items-start gap-3 rounded-xl border border-gray-800 bg-gray-900 hover:bg-gray-800 hover:border-gray-700 transition-colors px-4 py-4"
            >
              <div className="text-2xl leading-none">{ch.icon}</div>
              <div className="min-w-0">
                <div className="font-semibold text-white">{ch.title}</div>
                <div className="text-sm text-gray-400 mt-0.5">{ch.description}</div>
              </div>
            </Link>
          ))}

          {/* Txt marketing — planned next (drip/blast campaigns over SMS). */}
          <div className="flex items-start gap-3 rounded-xl border border-dashed border-gray-800 bg-gray-950 px-4 py-4 opacity-70">
            <div className="text-2xl leading-none">💬</div>
            <div className="min-w-0">
              <div className="font-semibold text-gray-400">Txt <span className="ml-1 text-[10px] uppercase tracking-wide text-gray-600 border border-gray-700 rounded px-1.5 py-0.5">coming soon</span></div>
              <div className="text-sm text-gray-600 mt-0.5">Drip &amp; blast campaigns over SMS — the same engine as Email.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
