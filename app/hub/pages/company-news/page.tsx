import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

type AnnType = 'announcement' | 'shout_out'

type Announcement = {
  id: string
  content: string
  created_at: string
  expires_at: string
  type: AnnType
  archived_at: string | null
  edited_at: string | null
  created_by_user: { display_name: string } | null
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

type Status = 'active' | 'archived' | 'expired'
function statusOf(a: Announcement, now: Date): Status {
  if (a.archived_at) return 'archived'
  if (new Date(a.expires_at) < now) return 'expired'
  return 'active'
}

function Card({ a, now }: { a: Announcement; now: Date }) {
  const status = statusOf(a, now)
  const isShout = a.type === 'shout_out'

  const wrapper =
    status === 'active'
      ? isShout
        ? 'bg-amber-500/10 border-amber-400/30'
        : 'bg-gray-900 border-gray-700'
      : 'bg-gray-900/50 border-gray-800'

  const text = status === 'active' && isShout ? 'text-amber-50' : status === 'active' ? 'text-white' : 'text-gray-400'

  const statusBadge: Record<Status, { label: string; cls: string }> = {
    active: { label: 'ACTIVE', cls: isShout ? 'bg-amber-500/20 text-amber-200' : 'bg-emerald-500/15 text-emerald-300' },
    archived: { label: 'ARCHIVED', cls: 'bg-yellow-500/15 text-yellow-300' },
    expired: { label: 'EXPIRED', cls: 'bg-gray-700 text-gray-400' },
  }
  const badge = statusBadge[status]

  return (
    <div className={`rounded-xl border p-4 ${wrapper}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${badge.cls}`}>
          {badge.label}
        </span>
      </div>
      <p className={`text-sm leading-relaxed whitespace-pre-wrap ${text}`}>
        {a.content}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span>
          Posted by <span className="text-gray-400">{a.created_by_user?.display_name ?? 'Unknown'}</span>
        </span>
        <span>on {formatDate(a.created_at)}</span>
        <span>
          {status === 'archived' && a.archived_at
            ? `Archived ${formatDate(a.archived_at)}`
            : status === 'expired'
              ? `Expired ${formatDate(a.expires_at)}`
              : `Expires ${formatDate(a.expires_at)}`}
        </span>
        {a.edited_at && <span className="italic text-gray-600">edited</span>}
      </div>
    </div>
  )
}

export default async function CompanyNewsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data, error } = await supabase
    .from('hub_announcements')
    .select(`
      id, content, created_at, expires_at, type, archived_at, edited_at,
      created_by_user:hub_users!created_by (display_name)
    `)
    .order('created_at', { ascending: false })

  const announcements: Announcement[] = (data ?? []).map((row: {
    id: string
    content: string
    created_at: string
    expires_at: string
    type: AnnType
    archived_at: string | null
    edited_at: string | null
    created_by_user: { display_name: string } | { display_name: string }[] | null
  }) => ({
    ...row,
    created_by_user: Array.isArray(row.created_by_user) ? row.created_by_user[0] : row.created_by_user,
  }))

  const now = new Date()
  const announcementsList = announcements.filter(a => a.type === 'announcement')
  const shoutOutsList = announcements.filter(a => a.type === 'shout_out')

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-950">
      <div className="flex-none px-6 py-4 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-lg">📰</span>
          <h1 className="text-lg font-semibold text-white">Company News</h1>
        </div>
        <p className="text-sm text-gray-500 mt-0.5">All company announcements and shout outs — read only</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error && (
          <p className="text-red-400 text-sm">Failed to load news.</p>
        )}

        <div className="max-w-2xl space-y-10">
          <section>
            <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span>📢</span> Announcements
            </h2>
            {announcementsList.length === 0 ? (
              <p className="text-gray-500 text-sm">No announcements yet.</p>
            ) : (
              <div className="space-y-3">
                {announcementsList.map(a => <Card key={a.id} a={a} now={now} />)}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-xs font-semibold text-amber-300/60 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span>🎉</span> Shout Outs
            </h2>
            {shoutOutsList.length === 0 ? (
              <p className="text-gray-500 text-sm">No shout outs yet.</p>
            ) : (
              <div className="space-y-3">
                {shoutOutsList.map(a => <Card key={a.id} a={a} now={now} />)}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
