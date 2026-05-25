import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

function relativeTime(iso: string) {
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default async function TxtBroadcastsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: broadcasts } = await supabase
    .from('txt_broadcasts')
    .select(
      `id, body, status, recipient_count, sent_count, failed_count, skipped_count,
       created_at, started_at, completed_at,
       creator:hub_users!created_by ( id, display_name )`
    )
    .order('created_at', { ascending: false })
    .limit(50)

  const rows = broadcasts ?? []

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 md:p-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Broadcasts</h1>
        <Link
          href="/hub/txt"
          className="text-sm text-white/60 hover:text-white"
        >
          ← Back to Txt
        </Link>
      </div>
      <p className="text-sm text-white/50 mb-4">
        Each broadcast sends an individual 1:1 text to each recipient. Replies land in the normal conversation.
      </p>

      {rows.length === 0 && (
        <div className="text-sm text-white/40 py-8 text-center border border-dashed border-white/10 rounded-md">
          No broadcasts yet.
        </div>
      )}

      <ul className="space-y-2">
        {rows.map((b) => {
          const creator = Array.isArray(b.creator) ? b.creator[0] : b.creator
          const statusColor =
            b.status === 'complete'
              ? 'text-emerald-300 bg-emerald-500/10'
              : b.status === 'processing'
              ? 'text-amber-300 bg-amber-500/10'
              : b.status === 'failed'
              ? 'text-red-300 bg-red-500/10'
              : 'text-white/60 bg-white/10'
          return (
            <li key={b.id}>
              <Link
                href={`/hub/txt/broadcasts/${b.id}`}
                className="block px-4 py-3 rounded-md bg-white/5 hover:bg-white/10 border border-white/10"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-md uppercase ${statusColor}`}>
                    {b.status}
                  </span>
                  <span className="text-[11px] text-white/40">
                    {creator?.display_name?.split(' ')[0] || 'Someone'} ·{' '}
                    {relativeTime(b.created_at)}
                  </span>
                </div>
                <div className="text-sm mt-1.5 line-clamp-2 whitespace-pre-wrap break-words">
                  {b.body}
                </div>
                <div className="text-[11px] text-white/50 mt-1.5 flex gap-3">
                  <span>{b.recipient_count} recipients</span>
                  <span className="text-emerald-300">{b.sent_count} sent</span>
                  {b.failed_count > 0 && (
                    <span className="text-red-300">{b.failed_count} failed</span>
                  )}
                  {b.skipped_count > 0 && (
                    <span className="text-white/40">{b.skipped_count} skipped</span>
                  )}
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
