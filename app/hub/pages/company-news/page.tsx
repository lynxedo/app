import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

type Announcement = {
  id: string
  content: string
  created_at: string
  expires_at: string
  created_by_user: { display_name: string } | null
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export default async function CompanyNewsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data, error } = await supabase
    .from('hub_announcements')
    .select(`
      id, content, created_at, expires_at,
      created_by_user:hub_users!created_by (display_name)
    `)
    .order('created_at', { ascending: false })

  const announcements: Announcement[] = (data ?? []).map((row: {
    id: string
    content: string
    created_at: string
    expires_at: string
    created_by_user: { display_name: string } | { display_name: string }[] | null
  }) => ({
    ...row,
    created_by_user: Array.isArray(row.created_by_user) ? row.created_by_user[0] : row.created_by_user,
  }))

  const now = new Date()

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-950">
      <div className="flex-none px-6 py-4 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-lg">📰</span>
          <h1 className="text-lg font-semibold text-white">Company News</h1>
        </div>
        <p className="text-sm text-gray-500 mt-0.5">All company announcements — read only</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error && (
          <p className="text-red-400 text-sm">Failed to load announcements.</p>
        )}
        {announcements.length === 0 && !error && (
          <p className="text-gray-500 text-sm">No announcements yet.</p>
        )}
        <div className="space-y-4 max-w-2xl">
          {announcements.map(a => {
            const expired = new Date(a.expires_at) < now
            return (
              <div
                key={a.id}
                className={`rounded-xl border p-4 ${
                  expired
                    ? 'bg-gray-900/50 border-gray-800'
                    : 'bg-gray-900 border-gray-700'
                }`}
              >
                <p className={`text-sm leading-relaxed whitespace-pre-wrap ${expired ? 'text-gray-400' : 'text-white'}`}>
                  {a.content}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span>
                    Posted by <span className="text-gray-400">{a.created_by_user?.display_name ?? 'Unknown'}</span>
                  </span>
                  <span>on {formatDate(a.created_at)}</span>
                  <span className={expired ? 'text-gray-600' : 'text-gray-500'}>
                    Expires {formatDate(a.expires_at)}{expired ? ' — expired' : ''}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
