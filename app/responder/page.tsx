import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import LogoutButton from '@/app/dashboard/LogoutButton'
import ResponderForm from './ResponderForm'

const SETTINGS_ID = '00000000-0000-0000-0000-000000000001'

export default async function ResponderPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: settings } = await supabase
    .from('responder_settings')
    .select('*')
    .eq('id', SETTINGS_ID)
    .single()

  const { data: recentCalls } = await supabase
    .from('responder_calls')
    .select('id, call_sid, from_number, called_at, has_voicemail, text_sent, email_sent, template_used, error_message')
    .order('called_at', { ascending: false })
    .limit(20)

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-gray-400 hover:text-white text-sm transition-colors">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-bold tracking-tight">📱 Responder</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">{user.email}</span>
          <Link href="/help" className="text-gray-400 hover:text-white transition-colors text-lg leading-none font-bold" title="Help">
            ?
          </Link>
          <Link href="/settings" className="text-gray-400 hover:text-white transition-colors text-lg leading-none" title="Settings">
            ⚙
          </Link>
          <LogoutButton />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8">
        <ResponderForm initial={settings} recentCalls={recentCalls ?? []} />
      </main>
    </div>
  )
}
